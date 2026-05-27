import os
import re
import json
import jinja2
import subprocess
import urllib.request
import urllib.parse
import urllib.error
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import TypedDict, List, Optional, Dict, Tuple, NamedTuple
from datetime import datetime
import logging
import click

import frontmatter
from .sitemap_generator import BASE_URL
from .build_journal import main as build_journal
from . import SITE_ROOT, GLOBAL_DICT, combine_meta_keywords
from ..generate_pages_json import main as generate_pages_json_main
from .sitemap_generator import main as sitemap_generator_main

LOGGER = logging.getLogger(__name__)

class TranslationDict(TypedDict):
    # A list is used for multi-line translations (i.e. descriptions)
    el: List[str]
    en: List[str]
    grc: List[str]


class ImageDict(TypedDict):
    filename: str
    caption: TranslationDict


class TaxonDict(TypedDict):
    name: TranslationDict
    rank: str
    description: TranslationDict
    extinct: Optional[bool]
    subtaxa: Optional[Dict[str, "TaxonDict"]]


class SampleDict(TypedDict):
    lowest_taxa: str
    locality: str
    images_dir: str
    images: List[ImageDict]

@dataclass
class Sample:
    sample_id: str
    lowest_taxa: str | List[str] # There can be multiple fossils in a sample. None for unidentified samples.
    locality: str | None  # Locality can be None if not specified
    images_dir: Path
    images: List[ImageDict]
    batch_images_dir: Optional[Path] = None  # Set for items that belong to a batch
    batch_images: List[ImageDict] = field(default_factory=list)  # Overview images from the batch

    @property
    def display_images(self) -> List[dict]:
        """Returns all images with a per-image 'images_dir' key. Batch images first, then item images."""
        result = []
        for img in self.batch_images:
            result.append({**img, 'images_dir': str(self.batch_images_dir)})
        for img in self.images:
            result.append({**img, 'images_dir': str(self.images_dir)})
        return result

    def to_dict(self):
        d = asdict(self)
        d["images_dir"] = str(self.images_dir)
        if self.batch_images_dir is not None:
            d["batch_images_dir"] = str(self.batch_images_dir)
        return d

    @staticmethod
    def _from_dict(sample_id: str, sample_info: SampleDict) -> "Sample":
        return Sample(
            sample_id=sample_id,
            lowest_taxa=sample_info["lowest_taxa"],
            locality=sample_info["locality"],
            images_dir=Path(sample_info["images_dir"]),
            images=sample_info["images"],
        )

    @staticmethod
    def from_json(json_file: Path) -> List["Sample"]:
        with open(json_file, "r") as f:
            samples_info = json.load(f)
        samples = []
        for sample_id, sample_info in samples_info.items():
            if sample_info.get("batch"):
                batch_images = sample_info["images"]
                batch_images_dir = Path(sample_info["images_dir"])
                locality = sample_info.get("locality")
                lowest_taxa = sample_info.get("lowest_taxa")
                for i, item in enumerate(sample_info["items"], start=1):
                    samples.append(Sample(
                        sample_id=f"{sample_id}_{i}",
                        lowest_taxa=lowest_taxa,
                        locality=locality,
                        images_dir=Path(item["images_dir"]),
                        images=item["images"],
                        batch_images_dir=batch_images_dir,
                        batch_images=batch_images,
                    ))
            else:
                samples.append(Sample._from_dict(sample_id, sample_info))
        return samples

    def is_taxon(self, taxon: str) -> bool:
        if isinstance(self.lowest_taxa, list):
            return taxon in self.lowest_taxa
        return self.lowest_taxa == taxon

    def is_unknown(self) -> bool:
        if isinstance(self.lowest_taxa, list):
            return None in self.lowest_taxa
        return not bool(self.lowest_taxa)

def greek_numeral(n: int) -> str:
    if not (1 <= n <= 9999):
        raise ValueError("Number out of range (1–9999 supported)")

    units = ['', 'α', 'β', 'γ', 'δ', 'ε', 'ϛ', 'ζ', 'η', 'θ']
    tens = ['', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ϟ']
    hundreds = ['', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', 'ϡ']

    parts = []

    if n >= 1000:
        thousands = n // 1000
        parts.append(f'͵{units[thousands]}')  # ͵α = 1000, ͵β = 2000, etc.
        n %= 1000

    h = n // 100
    t = (n % 100) // 10
    u = n % 10

    parts.append(hundreds[h])
    parts.append(tens[t])
    parts.append(units[u])

    return ''.join(parts) + 'ʹ'  # Right keraia at the end

SAMPLES = Sample.from_json(SITE_ROOT / "jsondata/samples_info.json")
JINJA_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(SITE_ROOT / "pyscripts/site_generator/templates"),
    keep_trailing_newline=True,
)

_LOCALITIES_INFO: Optional[Dict] = None
_TAXON_SAMPLE_COUNTS: Optional[Dict[str, int]] = None


def get_localities_info() -> Dict:
    global _LOCALITIES_INFO
    if _LOCALITIES_INFO is None:
        with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
            _LOCALITIES_INFO = json.load(f)["localities"]
    return _LOCALITIES_INFO


def get_taxon_sample_counts() -> Dict[str, int]:
    """Per-taxon sample counts, including descendants. Used for subtaxa badges."""
    global _TAXON_SAMPLE_COUNTS
    if _TAXON_SAMPLE_COUNTS is not None:
        return _TAXON_SAMPLE_COUNTS
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    ancestors_map = build_taxon_ancestors_map(taxonomy_info)
    counts: Dict[str, int] = {}
    for sample in SAMPLES:
        taxa = sample.lowest_taxa if isinstance(sample.lowest_taxa, list) else [sample.lowest_taxa]
        for taxon in taxa:
            if taxon is None:
                continue
            for ancestor in ancestors_map.get(taxon, [taxon]):
                counts[ancestor] = counts.get(ancestor, 0) + 1
    _TAXON_SAMPLE_COUNTS = counts
    return counts


_SUBDIVISION_FLAGS = {
    # UK subdivision tag sequences: 🏴 + tag chars for "gb-{sub}" + cancel tag
    "en": "\U0001F3F4\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F",
    "sc": "\U0001F3F4\U000E0067\U000E0062\U000E0073\U000E0063\U000E0074\U000E007F",
    "wl": "\U0001F3F4\U000E0067\U000E0062\U000E0077\U000E006C\U000E0073\U000E007F",
}


def country_to_flag_emoji(code: str) -> str:
    """Country/subdivision code → flag emoji.

    Handles standard ISO 3166-1 alpha-2 codes via regional indicators, plus
    UK subdivisions (en/sc/wl) using tag sequences (England/Scotland/Wales flags).
    """
    if not code:
        return ""
    if code in _SUBDIVISION_FLAGS:
        return _SUBDIVISION_FLAGS[code]
    if len(code) != 2 or not code.isalpha():
        return ""
    return "".join(chr(0x1F1E6 + ord(c.upper()) - ord('A')) for c in code)


def build_subtaxa_meta(subtaxa: Optional[Dict]) -> Dict[str, Dict]:
    """For each subtaxon: rank, sample_count (incl. descendants), extinct.

    Rank "species" is collapsed to None so it doesn't render a separate badge
    (species name itself carries the rank-level information).
    """
    if not subtaxa:
        return {}
    counts = get_taxon_sample_counts()
    out: Dict[str, Dict] = {}
    for sub_id, sub in subtaxa.items():
        rank = sub.get("rank")
        if rank == "species":
            rank = None
        out[sub_id] = {
            "rank": rank,
            "sample_count": counts.get(sub_id, 0),
            "extinct": bool(sub.get("extinct", False)),
        }
    return out


def build_locality_meta(locality_ids: List[str]) -> Dict[str, Dict]:
    """For each locality id: country code, flag emoji, formation presence flag.

    The translated strings (age, formation, name) are rendered into the per-page
    JSON via the json template; this dict carries only the language-agnostic data.
    """
    localities = get_localities_info()
    out: Dict[str, Dict] = {}
    for loc_id in locality_ids:
        info = localities.get(loc_id, {})
        country = info.get("country", "")
        out[loc_id] = {
            "country": country,
            "flag_emoji": country_to_flag_emoji(country),
            "has_formation": bool(info.get("formation")),
            "has_age": bool(info.get("age", {}).get("period")),
        }
    return out

def group_by_locality(samples: List[Sample]) -> Dict[str, List[Sample]]:
    locality_dict: Dict[str, List[Sample]] = {}
    for sample in samples:
        locality_name = sample.locality
        if locality_name not in locality_dict:
            locality_dict[locality_name] = []
        locality_dict[locality_name].append(sample)
    return locality_dict

def mycapitalize(s: str) -> str:
    return "†"+s[1:].capitalize() if s.startswith("†") else s.capitalize()

def truncate_meta_description(long_description: str) -> str:
    limit = 160
    if len(long_description) < limit:
        return long_description
    truncated = long_description[:limit]
    last_sentence_end = truncated.rfind('.')
    if last_sentence_end == -1:
        return truncated
    return truncated[:last_sentence_end+1]

def generate_taxonomy_tree_files(cwd: Path, current_taxon: str, taxon_dict: TaxonDict):
    # this method recursively generates cwd / current_taxon.html page with the samples classified under the current taxon
    taxon_samples = [sample for sample in SAMPLES if sample.is_taxon(current_taxon)]
    samples_by_locality = group_by_locality(taxon_samples)
    locality_meta = build_locality_meta(list(samples_by_locality.keys()))
    subtaxa_meta = build_subtaxa_meta(taxon_dict.get("subtaxa"))

    html_file = cwd / f"{current_taxon}.html"
    template_html = JINJA_ENV.get_template("taxon.html.template")
    meta_keywords_combined = combine_meta_keywords(taxon_dict.get("meta_keywords", {}))
    taxon_icon = get_resolved_taxon_icons().get(current_taxon)
    taxon_html = template_html.render(
        samples_by_locality=samples_by_locality,
        locality_meta=locality_meta,
        subtaxa_meta=subtaxa_meta,
        dir="/" + cwd.relative_to(SITE_ROOT).as_posix(),
        root_relative_prefix="../" * len(cwd.relative_to(SITE_ROOT).parts),
        name_en=taxon_dict["name"]["en"],
        name_el=taxon_dict["name"]["el"],
        subtaxa=taxon_dict["subtaxa"],
        taxon_id=current_taxon,
        taxon_rank=taxon_dict.get("rank"),
        taxon_extinct=bool(taxon_dict.get("extinct", False)),
        description_paragraphs=len(taxon_dict["description"]["en"]),
        etymology_paragraphs=len(taxon_dict.get("etymology", {}).get("en", [])),
        meta_description=truncate_meta_description(taxon_dict["description"]["en"][0]),
        meta_keywords=meta_keywords_combined,
        taxon_icon=taxon_icon,
    )
    html_file.write_text(taxon_html)

    json_file = cwd / f"{current_taxon}.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    localities_info = get_localities_info()
    taxon_json = template_json.render(
        taxon=taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        taxon_id=current_taxon,
        localities_info=localities_info,
        subtaxa_meta=subtaxa_meta,
    )
    json_file.write_text(taxon_json)

    if taxon_dict["subtaxa"]:
        for sub_taxon, sub_taxon_info in taxon_dict["subtaxa"].items():
            sub_cwd = cwd / sub_taxon
            sub_cwd.mkdir(parents=True, exist_ok=True)
            generate_taxonomy_tree_files(sub_cwd, sub_taxon, sub_taxon_info)

unknown_taxon_dict: TaxonDict = {
    "name": {
        "el": "ακατηγοριοποίητα",
        "en": "unclassified",
        "grc": "ἀκατηγοριοποίητα"
    },
    "rank": None,
    "description": {
        "el": ["Δείγματα που δεν μπόρεσα να ταξινομήσω σε καμία από τις κατηγορίες. Πιθανόν και να μην είναι απολιθώματα."],
        "en": ["Samples that I could not classify into any of the categories. They may not even be fossils."],
        "grc": ["Δείγματα ἅ οὐκ ἐδυνάμην ταξινομεῖν εἰς τινά τῶν κατηγοριῶν. Πιθανόν δε ἀπολιθώματα αὐτά μη εἶναι."]
    },
    "subtaxa": {},
    "path": "unclassified.html",
}

def generate_unknown_samples_files():
    unknown_samples = [sample for sample in SAMPLES if sample.is_unknown()]
    samples_by_locality = group_by_locality(unknown_samples)
    locality_meta = build_locality_meta(list(samples_by_locality.keys()))

    html_file = SITE_ROOT / f"unclassified.html"
    template_html = JINJA_ENV.get_template("taxon.html.template")
    taxon_html = template_html.render(
        samples_by_locality=samples_by_locality,
        locality_meta=locality_meta,
        subtaxa_meta={},
        dir="",
        root_relative_prefix="",
        name_en="unclassified",
        name_el="ακατηγοριοποίητα",
        subtaxa={},
        taxon_id="unclassified",
        taxon_rank=None,
        taxon_extinct=False,
        description_paragraphs=len(unknown_taxon_dict["description"]["el"]),
        etymology_paragraphs=0,
    )
    html_file.write_text(taxon_html)

    json_file = SITE_ROOT / f"unclassified.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    taxon_json = template_json.render(
        taxon=unknown_taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        taxon_id="unclassified",
    )
    json_file.write_text(taxon_json)

def generate_taxa_info(cwd: Path, current_taxon: str, taxon_dict: TaxonDict) -> Dict[str, str]:
    links = {
        current_taxon: {
            "link": f"{cwd.relative_to(SITE_ROOT)}/{current_taxon}/{current_taxon}.html",
            "extinct": taxon_dict.get("extinct", False)
        }
    }
    if taxon_dict["subtaxa"]:
        for subtaxon, subtaxon_dict in taxon_dict["subtaxa"].items():
            links.update(generate_taxa_info(cwd / current_taxon, subtaxon, subtaxon_dict))
    return links

def generate_random_samples_json():
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    taxa_info = {}
    for taxon, taxon_dict in taxonomy_info.items():
        cwd = SITE_ROOT / "tree"
        taxa_info.update(generate_taxa_info(cwd, taxon, taxon_dict))
    template_js_script = JINJA_ENV.get_template("random-sample.js.template")
    random_sample_js = template_js_script.render(
        taxa_info = taxa_info,
        samples = list(json.loads((SITE_ROOT / "jsondata/samples_info.json").read_text().replace("null", "\"άγνωστο\"")).values())
    )
    (SITE_ROOT / "scripts" / "random-sample.js").write_text(random_sample_js)

def build_taxon_ancestors_map(taxonomy_info: Dict[str, TaxonDict]) -> Dict[str, List[str]]:
    """For each taxon key, return the full list of ancestor taxa including itself.

    Example: 'phacopida' -> ['animalia', 'arthropoda', 'trilobita', 'phacopida'].
    """
    result: Dict[str, List[str]] = {}

    def walk(taxon_key: str, taxon_info: TaxonDict, ancestors: List[str]) -> None:
        chain = ancestors + [taxon_key]
        result[taxon_key] = chain
        subtaxa = taxon_info.get("subtaxa") or {}
        for sub_key, sub_info in subtaxa.items():
            walk(sub_key, sub_info, chain)

    for top_key, top_info in taxonomy_info.items():
        walk(top_key, top_info, [])
    return result


def flat_taxa_list(taxonomy_info: Dict[str, TaxonDict]) -> List[Dict]:
    """Flat list of all taxa (excluding 'unclassified'), each with key, names, rank.

    Used to populate TAXA_INDEX for the explore page autocomplete.
    """
    result: List[Dict] = []

    def walk(taxon_key: str, taxon_info: TaxonDict) -> None:
        result.append({
            "key": taxon_key,
            "names": taxon_info["name"],
            "rank": taxon_info.get("rank"),
        })
        subtaxa = taxon_info.get("subtaxa") or {}
        for sub_key, sub_info in subtaxa.items():
            walk(sub_key, sub_info)

    for top_key, top_info in taxonomy_info.items():
        walk(top_key, top_info)
    return result


def compute_locality_taxa_present(
    samples: List[Sample], ancestors_map: Dict[str, List[str]]
) -> List[str]:
    """Union of all ancestor taxa for every sample at a locality.

    Returns a sorted list of taxon keys present at the locality, expanded to
    include all ancestors (so filtering by 'arthropoda' matches localities
    whose deepest sample is 'phacopida').
    """
    present: set[str] = set()
    for sample in samples:
        taxa = sample.lowest_taxa if isinstance(sample.lowest_taxa, list) else [sample.lowest_taxa]
        for taxon in taxa:
            if taxon is None:
                continue
            for ancestor in ancestors_map.get(taxon, [taxon]):
                present.add(ancestor)
    return sorted(present)


PHYLOPIC_CACHE_PATH = Path("jsondata/phylopic_cache.json")

# Taxa whose PhyloPic name differs from our key. The user-visible name stays
# the same; only the PhyloPic search query is overridden so the silhouette
# matches the colloquial meaning (e.g. "Plantae" = land plants, not algae).
PHYLOPIC_NAME_OVERRIDES = {
    "plantae": "Embryophyta",
}


def _phylopic_get(path: str, params: Optional[Dict[str, str]] = None) -> Dict:
    """GET a PhyloPic API endpoint, following redirects."""
    url = f"https://api.phylopic.org{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


_LICENSE_NAMES = {
    "/licenses/by/": "CC BY",
    "/licenses/by-sa/": "CC BY-SA",
    "/licenses/by-nc/": "CC BY-NC",
    "/licenses/by-nc-sa/": "CC BY-NC-SA",
    "/licenses/by-nd/": "CC BY-ND",
    "/licenses/by-nc-nd/": "CC BY-NC-ND",
    "/publicdomain/zero/": "CC0",
    "/publicdomain/mark/": "Public Domain",
}


def _license_name_from_url(url: str) -> str:
    """Derive a short license label from a Creative Commons URL."""
    if not url:
        return ""
    for pattern, name in _LICENSE_NAMES.items():
        if pattern in url:
            version_match = re.search(r"/(\d+\.\d+)/?$", url)
            if version_match:
                return f"{name} {version_match.group(1)}"
            return name
    return url


def fetch_phylopic_attribution(image_uuid: str, build: str) -> Dict[str, str]:
    """Return {'artist', 'license_url', 'license_name'} for a PhyloPic image.

    Returns empty strings on failure rather than None — callers can treat
    them as missing without special-casing.
    """
    try:
        data = _phylopic_get(
            f"/images/{image_uuid}",
            {"build": build, "embed_contributor": "true"},
        )
        contributor = data.get("_embedded", {}).get("contributor", {})
        license_url = data.get("_links", {}).get("license", {}).get("href", "")
        return {
            "artist": contributor.get("name") or "Anonymous",
            "license_url": license_url,
            "license_name": _license_name_from_url(license_url),
        }
    except Exception as exc:
        LOGGER.warning(f"PhyloPic attribution fetch failed for {image_uuid}: {exc}")
        return {"artist": "", "license_url": "", "license_name": ""}


def fetch_phylopic_icon(taxon_name: str, build: str) -> Optional[Dict]:
    """Return {"vector_url", "image_uuid", "node_uuid", "artist", "license_*"} or None.

    Looks up the taxon node by name, then takes the first image filed under
    that exact node. Falls back to the first image of the node's clade if
    no node-specific image exists. Attribution data is fetched in the same pass.
    """
    def _list_images(params: Dict[str, str]) -> List[Dict]:
        """Call /images, returning [] on 404 (out-of-bounds page = no results)."""
        try:
            data = _phylopic_get("/images", params)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return []
            raise
        return data.get("_embedded", {}).get("items", [])

    try:
        nodes = _phylopic_get(
            "/nodes",
            {"build": build, "filter_name": taxon_name.lower(), "page": "0", "embed_items": "true"},
        )
        items = nodes.get("_embedded", {}).get("items", [])
        if not items:
            LOGGER.warning(f"PhyloPic: no node found for {taxon_name}")
            return None
        node_uuid = items[0]["uuid"]

        img_items = _list_images({
            "build": build, "filter_node": node_uuid, "page": "0", "embed_items": "true",
        })
        if not img_items:
            # Fall back to any image in the clade.
            img_items = _list_images({
                "build": build, "filter_clade": node_uuid, "page": "0", "embed_items": "true",
            })
        if not img_items:
            LOGGER.warning(f"PhyloPic: no images for {taxon_name}")
            return None
        img = img_items[0]
        attribution = fetch_phylopic_attribution(img["uuid"], build)
        return {
            "node_uuid": node_uuid,
            "image_uuid": img["uuid"],
            "vector_url": img.get("_links", {}).get("vectorFile", {}).get("href")
                or f"https://images.phylopic.org/images/{img['uuid']}/vector.svg",
            **attribution,
        }
    except Exception as exc:
        LOGGER.warning(f"PhyloPic fetch failed for {taxon_name}: {exc}")
        return None


def _get_phylopic_build() -> Optional[str]:
    """Fetch the current PhyloPic build number, or None on failure."""
    try:
        root = _phylopic_get("/")
        return str(root.get("build") or "") or None
    except Exception as exc:
        LOGGER.warning(f"PhyloPic root unreachable: {exc}")
        return None


def enrich_phylopic_cache() -> Dict[str, Dict]:
    """Backfill artist + license fields on existing cache entries.

    Reads `jsondata/phylopic_cache.json`, fetches attribution for entries
    missing the `artist` field, and writes the cache back. Returns the
    enriched cache dict.
    """
    cache_path = SITE_ROOT / PHYLOPIC_CACHE_PATH
    if not cache_path.exists():
        return {}
    try:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception as exc:
        LOGGER.warning(f"PhyloPic cache unreadable: {exc}")
        return {}

    needs_attribution = [k for k, v in cache.items() if v.get("image_uuid") and not v.get("artist")]
    if not needs_attribution:
        return cache

    build = _get_phylopic_build()
    if not build:
        return cache

    for taxon in needs_attribution:
        attribution = fetch_phylopic_attribution(cache[taxon]["image_uuid"], build)
        if attribution["artist"]:
            cache[taxon].update(attribution)

    cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return cache


def get_phylopic_icons(taxa: List[str]) -> Dict[str, Dict]:
    """Return cached PhyloPic icon info for each taxon name (lowercased).

    Reads `jsondata/phylopic_cache.json`, fetches any missing taxa from the
    PhyloPic API, and writes the cache back. Missing taxa simply don't appear
    in the returned mapping (callers should fall back gracefully).
    """
    cache: Dict[str, Dict] = {}
    cache_path = SITE_ROOT / PHYLOPIC_CACHE_PATH
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception as exc:
            LOGGER.warning(f"PhyloPic cache unreadable, starting fresh: {exc}")
            cache = {}

    missing = [t for t in taxa if t not in cache]
    if not missing:
        return cache

    build = _get_phylopic_build()
    if not build:
        LOGGER.warning("PhyloPic build number missing; skipping fetch")
        return cache

    for taxon in missing:
        query_name = PHYLOPIC_NAME_OVERRIDES.get(taxon, taxon)
        info = fetch_phylopic_icon(query_name, build)
        if info:
            cache[taxon] = info

    cache_path.write_text(json.dumps(cache, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return cache


# Cache the resolved {taxon_key: icon_url} mapping after the first computation
# so that multiple page generators can share it without re-fetching.
_TAXON_ICONS_RESOLVED: Optional[Dict[str, str]] = None


def get_resolved_taxon_icons() -> Dict[str, str]:
    """Return the per-taxon PhyloPic icon URLs with ancestor fallback.

    For taxa missing a direct PhyloPic silhouette, walks up the taxonomy
    until it finds an ancestor that does, so every entry in the result
    has *some* icon. The mapping is also written to `jsondata/taxa_icons.json`
    for client-side use (header search, etc.).
    """
    global _TAXON_ICONS_RESOLVED
    if _TAXON_ICONS_RESOLVED is not None:
        return _TAXON_ICONS_RESOLVED

    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    ancestors_map = build_taxon_ancestors_map(taxonomy_info)
    flat = flat_taxa_list(taxonomy_info)
    all_keys = [t["key"] for t in flat]

    phylopic_icons = get_phylopic_icons(all_keys)
    direct = {k: v["vector_url"] for k, v in phylopic_icons.items() if v.get("vector_url")}

    resolved: Dict[str, str] = {}
    for entry in flat:
        key = entry["key"]
        icon = direct.get(key)
        if not icon:
            for ancestor in reversed(ancestors_map.get(key, [])[:-1]):
                if ancestor in direct:
                    icon = direct[ancestor]
                    break
        if icon:
            resolved[key] = icon

    (SITE_ROOT / "jsondata/taxa_icons.json").write_text(
        json.dumps(resolved, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _TAXON_ICONS_RESOLVED = resolved
    return resolved


def generate_explore_page():
    """Generate the Explore page (formerly map.html): filterable map + geological timeline."""
    with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    with open(SITE_ROOT / "jsondata/ics_periods.json", "r") as f:
        ics_periods = json.load(f)

    ancestors_map = build_taxon_ancestors_map(taxonomy_info)
    taxa_index = flat_taxa_list(taxonomy_info)
    samples_by_loc = group_by_locality(SAMPLES)

    # Major taxa shown as quick-select pills. Mostly phylum-level; dinosauria
    # is included as a sub-clade because it's a highlight of the collection.
    major_taxa = [
        "chordata", "dinosauria", "mollusca", "arthropoda", "echinodermata",
        "cnidaria", "plantae", "bacteria",
    ]

    # PhyloPic silhouettes for every taxon (with ancestor fallback). Shared via
    # the module-level cache so taxon-page generation can use the same data.
    taxon_icons = get_resolved_taxon_icons()
    for entry in taxa_index:
        entry["icon"] = taxon_icons.get(entry["key"])

    localities_dataset: List[Dict] = []
    for loc_id, loc_info in geodata["localities"].items():
        if "coords_lat" not in loc_info:
            continue
        samples = samples_by_loc.get(loc_id, [])
        # Choose a thumbnail from the first sample at this locality if available
        thumbnail = None
        if samples and samples[0].display_images:
            first_img = samples[0].display_images[0]
            thumbnail = f"{first_img['images_dir']}/thumbs_dir/{first_img['filename']}_thumb.jpg"
        localities_dataset.append({
            "key": loc_id,
            "name": loc_info["name"],
            "url": f"localities/{loc_id}.html",
            "coords": [float(loc_info["coords_lat"]), float(loc_info["coords_lon"])],
            "country": loc_info.get("country", "unknown"),
            "age": loc_info.get("age", {}),
            "sample_count": len(samples),
            "taxa_present": compute_locality_taxa_present(samples, ancestors_map),
            "thumbnail": thumbnail,
        })

    template_html = JINJA_ENV.get_template("map.html.template")
    html_text = template_html.render(
        root_relative_prefix="./",
        meta_description="A fossil collection displayed on a filterable map and geological timeline.",
        localities_dataset=json.dumps(localities_dataset, ensure_ascii=False),
        taxa_index=json.dumps(taxa_index, ensure_ascii=False),
        major_taxa=json.dumps(major_taxa, ensure_ascii=False),
        ics_periods=json.dumps(ics_periods["periods"], ensure_ascii=False),
        countries=json.dumps(geodata["countries"], ensure_ascii=False),
        taxon_icons=json.dumps(taxon_icons, ensure_ascii=False),
    )
    Path("map.html").write_text(html_text)

    # map.json kept for compatibility with the language-script dict path
    template_json = JINJA_ENV.get_template("map.json.template")
    Path("map.json").write_text(template_json.render())


# Kept as alias for backwards compatibility with any external callers.
generate_map_page = generate_explore_page

def group_by_taxon(samples: List[Sample]) -> Dict[str, List[Sample]]:
    taxon_dict: Dict[str, List[Sample]] = {}
    for sample in samples:
        taxa = sample.lowest_taxa if isinstance(sample.lowest_taxa, list) else [sample.lowest_taxa]
        for taxon in taxa:
            if taxon is None:
                taxon = "unclassified"
            if taxon not in taxon_dict:
                taxon_dict[taxon] = []
            taxon_dict[taxon].append(sample)
    return taxon_dict

def flatten_taxonomy_tree(path: Path, taxonomy: Dict[str, TaxonDict]) -> List[Tuple[str, TaxonDict]]:
    flat_taxonomy = []
    for taxon, taxon_info in taxonomy.items():
        taxon_info["path"] = path / taxon / f"{taxon}.html"
        flat_taxonomy.append((taxon, taxon_info))
        if "subtaxa" in taxon_info and taxon_info["subtaxa"]:
            flat_taxonomy.extend(flatten_taxonomy_tree(path / taxon, taxon_info["subtaxa"]))
    return flat_taxonomy

def generate_locality_pages():
    # Clean up old locality pages
    subprocess.run(["rm", "-rf", "localities"])
    os.mkdir("localities")
    # this method generates  /localities/<loc>.html pages with a page for each locality in geochronology.json
    samples_by_locality = group_by_locality(SAMPLES)
    with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = flatten_taxonomy_tree(Path("tree"), json.load(f))
    taxonomy_info.append(("unclassified", unknown_taxon_dict))
    taxonomy_info.sort()

    localities_info = geodata["localities"]

    for locality, samples in samples_by_locality.items():
        samples_by_taxon = group_by_taxon(samples)
        locality_taxonomy_info = [(taxon_id, taxon_info) for taxon_id, taxon_info in taxonomy_info if taxon_id in samples_by_taxon]

        html_file = Path(f"localities/{locality}.html")
        if not html_file.exists():
            html_file.touch()
        template_html = JINJA_ENV.get_template("locality.html.template")
        meta_keywords_combined = combine_meta_keywords(localities_info[locality].get("meta_keywords", {}))
        locality_html = template_html.render(
            samples_by_taxon=samples_by_taxon,
            locality_taxonomy_info=locality_taxonomy_info,
            dir="/localities",
            root_relative_prefix="../",
            name_en=localities_info[locality]["name"]["en"],
            name_el=localities_info[locality]["name"]["el"],
            loc=localities_info[locality],
            loc_id=locality,
            description_paragraphs=len(localities_info[locality]["description"]["en"]),
            meta_description=truncate_meta_description(localities_info[locality]["description"]["en"][0]),
            meta_keywords=meta_keywords_combined
        )
        html_file.write_text(locality_html)

        json_file = Path(f"localities/{locality}.json")
        if not json_file.exists():
            json_file.touch()
        template_json = JINJA_ENV.get_template("locality.json.template")
        locality_json = template_json.render(
            samples_by_taxon=samples_by_taxon,
            locality_taxonomy_info=locality_taxonomy_info,
            loc=localities_info[locality],
            to_grc_number=greek_numeral,
            globaldict=GLOBAL_DICT,
            loc_id=locality,
        )
        json_file.write_text(locality_json)

class RecentlyUpdatedPage(NamedTuple):
    url: str
    lastmod: str
    title: Dict[str, str]
    thumbnail_jpg: str
    thumbnail_webp: str
    id: str
    description: Optional[Dict[str, str]] = None

def generate_locality_description(geochronology_info: Dict, locality_info: Dict, language: str) -> str:
    """
    Generates a short description for a locality based on its info.
    The format of the description is:
    "[country], [geological period]. [paleoecology highlights]."    

    :param geochronology_info: Taken from geochronology.json
    :type geochronology_info: Dict
    :param locality_info: The locality information taken from geochronology.json
    :type locality_info: Dict
    :param language: Language code ('el', 'en', 'grc')
    :type language: str
    :return: Generated description
    :rtype: str
    """
    country = geochronology_info["countries"].get(locality_info.get("country", {}), {}).get("name", {}).get(language, "")
    geological_period = GLOBAL_DICT[language].get(locality_info.get("age", {}).get("period", {}), "").capitalize()
    paleoecology = locality_info.get("paleoecology_highlights", {}).get(language, "")

    description_parts = [country, geological_period, paleoecology]
    if all(description_parts):
        return f"{country}, {geological_period}. {paleoecology}."
    elif country and geological_period:
        return f"{country}, {geological_period}."
    elif country and paleoecology:
        return f"{country}. {paleoecology}."
    elif geological_period and paleoecology:
        return f"{geological_period}. {paleoecology}."
    elif any(description_parts):
        return next(part for part in description_parts if part) + "."
    else:
        return ""

def get_journal_entry_title_description(journal_id: str) -> Tuple[Dict[str, str], Optional[Dict[str, str]]]:
    """
    Retrieves the title and description for a journal entry from its -<language>.md files.

    :param journal_id: Journal entry ID
    :type journal_id: str
    :return: Tuple of title dict and description dict
    :rtype: Tuple[Dict[str, str], Optional[Dict[str, str]]]
    """
    title: Dict[str, str] = {}
    description: Dict[str, str] = {}
    for lang in GLOBAL_DICT.keys():
        md_file = SITE_ROOT / "journal" / "entries" / f"{journal_id}-{lang.upper()}.md"
        if not md_file.exists():
            LOGGER.warning(f"Journal entry markdown file not found: {md_file}")
            continue
        entry = frontmatter.load(md_file)
        if "title" in entry.metadata:
            title[lang] = entry.metadata["title"]
        else:
            LOGGER.warning(f"Title not found in metadata of {md_file}")
        if "summary" in entry.metadata:
            description[lang] = entry.metadata["summary"]
        else: 
            LOGGER.warning(f"Summary not found in metadata of {md_file}")
    return title, description if description else None

def get_recently_updated_pages(n: int) -> List[RecentlyUpdatedPage]:
    """
    Uses sitemap.xml to get the n most recently updated pages.
    
    :param n: Number of pages to retrieve
    :type n: int
    :return: List of recently updated pages
    :rtype: List[Any]
    """
    sitemap_file = SITE_ROOT / "sitemap.xml"
    with open(sitemap_file, "r") as f:
        sitemap_xml = f.read()
    # Parse XML
    import xml.etree.ElementTree as ET
    root = ET.fromstring(sitemap_xml)
    namespace = {"ns": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = []
    for url in root.findall("ns:url", namespace):
        loc = url.find("ns:loc", namespace).text or ""
        lastmod = url.find("ns:lastmod", namespace).text or ""

        relative_path = loc.replace(BASE_URL + "/", "")
        basename = os.path.basename(relative_path)
        description = None
        ignore = ["index.html", "gallery.html", "map.html", "acknowledgements.html", "quiz.html"]
        if relative_path.startswith("localities"):
            # Locality page
            locality_id = os.path.splitext(basename)[0]
            with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
                geodata = json.load(f)
            locality_info = geodata["localities"].get(locality_id, {})
            title = locality_info.get("name", {})
            thumbnail_base = "images/localities/thumbnails"
            thumbnail_name = locality_id
            id = locality_id
            description = {
                language: generate_locality_description(geodata, locality_info, language) for language in title.keys()
            }
        elif relative_path.startswith("tree"):
            # Taxon page
            taxon_id = os.path.splitext(basename)[0]
            with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
                taxonomy_info = json.load(f)
            # Flatten taxonomy to find taxon info
            flat_taxonomy = flatten_taxonomy_tree(Path("tree"), taxonomy_info)
            taxon_info = dict(flat_taxonomy).get(taxon_id, {})
            title = {language: name_translation.capitalize() for language, name_translation in taxon_info.get("name", {}).items()}
            thumbnail_base = "images/thumbnails"
            thumbnail_name = taxon_info.get("name", {}).get("el", "").capitalize()
            id = taxon_id
            description = {
                language: taxon_info.get("description", {}).get(language, [""])[0] for language in title.keys()
            }
        elif relative_path == "unclassified.html":
            title = {language: name_translation.capitalize() for language, name_translation in unknown_taxon_dict.get("name", {}).items()}
            thumbnail_base = "images/thumbnails/"
            thumbnail_name = "Ακατηγοριοποίητα"
            lastmod = lastmod
            id = "unclassified"
            description = {
                language: unknown_taxon_dict.get("description", {}).get(language, [""])[0] for language in title.keys()
            }
        elif relative_path.startswith("journal/"):
            # Journal entry page
            journal_id = os.path.splitext(basename)[0]
            if journal_id == "index":
                continue  # Skip journal index page
            title, description = get_journal_entry_title_description(journal_id)
            thumbnail_base = f"journal/media/{journal_id}/"
            thumbnail_name = "cover"
            id = journal_id
        elif relative_path in ignore:
            LOGGER.debug(f"Skipping ignored page: {relative_path}")
            continue  # Skip these pages
        else:
            LOGGER.warning(f"Skipping unknown relative path: {relative_path}")
            continue
        if all([loc, lastmod, title, id]):
          recentlyUpdatedPage = RecentlyUpdatedPage(
              url=relative_path,
              lastmod=lastmod,
              title=title,
              thumbnail_jpg = f"{thumbnail_base}/{thumbnail_name}.jpg",
              thumbnail_webp = f"{thumbnail_base}/webp_dir/{thumbnail_name}.webp",
              id=id,
              description=description
          )
          urls.append(recentlyUpdatedPage)
    
    # Sort by lastmod descending
    urls.sort(key=lambda x: datetime.fromisoformat(x.lastmod), reverse=True)
    return urls[:min(n, len(urls))]

GALLERY_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="./style.css" />
    <link rel="stylesheet" href="./scripts/gallery.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery@2/css/lightgallery.css" />
</head>
<body>
    <div id="header-container"></div>
    <div id="paste-point"></div>
    <div id="footer-container"></div>

    <div id="cookie-banner" style="display:none; position:fixed; bottom:0; left:0; right:0; background:#222; color:#fff; padding:1em; z-index:9999; font-size:14px; text-align:center;">
        <a id="cookie-banner-text">This site uses cookies to analyze traffic.</a>
        <button onclick="setConsent(true)" style="margin-left:1em;" id="cookie-banner-accept">Accept</button>
        <button onclick="setConsent(false)" style="margin-left:0.5em;" id="cookie-banner-decline">Decline</button>
    </div>

    <script
        id="language-script"
        src="./scripts/language.js"
        dict="/jsondata/dict.json"
        keys=""
        galleryLength="0"
    ></script>
    <script src="./scripts/sidebar.js"></script>
    <script src="./scripts/search.js"></script>
    <script src="./scripts/analytics.js"></script>
    <script src="./scripts/footer.js"></script>
    <script src="./scripts/header.js" id="header-script"></script>

    <script src="https://cdn.jsdelivr.net/npm/lightgallery@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/zoom/lg-zoom.umd.js"></script>

    {% if slideshow %}
    <script src="./scripts/slideshow.js"></script>
    {% endif %}
    <script src="./scripts/journal.js" id="journal-script" file_path="{{file_path}}"></script>
    <script src="./scripts/gallery.js" id="gallery-script"></script>
</body>
</html>
"""

def _format_age_text(age: Dict, lang: str) -> str:
    """Format an age dict as '[Prefix] Period[, X-Y mya | ~X mya]'."""
    if not age:
        return ""
    parts = []
    if age.get("prefix"):
        parts.append(GLOBAL_DICT[lang][age["prefix"]].capitalize())
    if age.get("period") and age["period"] in GLOBAL_DICT[lang]:
        parts.append(GLOBAL_DICT[lang][age["period"]].capitalize())
    text = " ".join(parts)
    if "about" in age:
        text += f", ~{age['about']} {GLOBAL_DICT[lang]['mya']}"
    elif "from" in age and "to" in age:
        text += f", {age['from']}–{age['to']} {GLOBAL_DICT[lang]['mya']}"
    return text


def _build_lightbox_caption(image: Dict, sample: 'Sample', locality_info: Optional[Dict],
                             taxonomy_paths: Dict[str, str], lang: str) -> str:
    """Compose the data-sub-html HTML shown in the lightbox for one gallery image."""
    parts = [f"<p>{image['caption'].get(lang, '')}</p>"]
    meta_rows: List[str] = []
    if locality_info:
        loc_name = locality_info.get("name", {}).get(lang, "")
        loc_id = sample.locality
        if loc_name and loc_id:
            meta_rows.append(
                f"<span>📍 <a href='/localities/{loc_id}.html'>{loc_name}</a></span>"
            )
        age_text = _format_age_text(locality_info.get("age", {}), lang)
        if age_text:
            meta_rows.append(f"<span>🌍 {age_text}</span>")
    taxa = sample.lowest_taxa if isinstance(sample.lowest_taxa, list) else [sample.lowest_taxa]
    for t in taxa:
        if t and t in GLOBAL_DICT[lang] and t in taxonomy_paths:
            meta_rows.append(
                f"<span>🦴 <a href='/{taxonomy_paths[t]}'>{GLOBAL_DICT[lang][t].capitalize()}</a></span>"
            )
    if meta_rows:
        parts.append("<div class='lightbox-meta'>" + "".join(meta_rows) + "</div>")
    return "".join(parts)


def generate_gallery_page():
    """
    Generates gallery.html and gallery.json pages displaying all fossils in a grid.
    Images are organized by locality, with captions from samples_info.json.
    """
    # Load locality + taxonomy info for the enriched lightbox captions.
    with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)
    localities_info = geodata["localities"]
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = flatten_taxonomy_tree(Path("tree"), json.load(f))
    taxonomy_paths = {key: str(info["path"]) for key, info in taxonomy_info}

    # Render HTML for each language dynamically
    for lang in GLOBAL_DICT.keys():
        # Group images by locality
        gallery_by_locality: Dict[str, List[Dict]] = {}
        seen_batch_dirs: set = set()
        # Process each sample and extract images
        for sample in SAMPLES:
            locality_id = sample.locality
            locality_info = localities_info.get(locality_id)
            # Use locality name if available, otherwise use the ID
            locality_name = (locality_info or {}).get("name", {}).get(lang, locality_id)
            if locality_name not in gallery_by_locality:
                gallery_by_locality[locality_name] = []

            # Add batch images only once per batch
            if sample.batch_images_dir is not None:
                batch_key = str(sample.batch_images_dir)
                if batch_key not in seen_batch_dirs:
                    seen_batch_dirs.add(batch_key)
                    for image in sample.batch_images:
                        img_dir = str(sample.batch_images_dir)
                        gallery_by_locality[locality_name].append({
                            "thumbnail_path": f"{img_dir}/thumbs_dir/{image['filename']}_thumb.jpg",
                            "image_path": f"{img_dir}/{image['filename']}.jpg",
                            "webp_path": f"{img_dir}/webp_dir/{image['filename']}.webp",
                            "caption": image["caption"],
                            "lightbox_html": _build_lightbox_caption(image, sample, locality_info, taxonomy_paths, lang),
                        })

            # Add individual images
            for image in sample.images:
                img_dir = str(sample.images_dir)
                gallery_by_locality[locality_name].append({
                    "thumbnail_path": f"{img_dir}/thumbs_dir/{image['filename']}_thumb.jpg",
                    "image_path": f"{img_dir}/{image['filename']}.jpg",
                    "webp_path": f"{img_dir}/webp_dir/{image['filename']}.webp",
                    "caption": image["caption"],
                    "lightbox_html": _build_lightbox_caption(image, sample, locality_info, taxonomy_paths, lang),
                })
        
        language_specific_file = SITE_ROOT / f"gallery-{lang}.html"
        template_html = JINJA_ENV.get_template("gallery.html.template")
        gallery_html = template_html.render(
            root_relative_prefix="./",
            meta_description={
                "el": "Έκθεση φωτογραφιών απολιθωμάτων από τη συλλογή.",
                "en": "A gallery of fossils from the collection.",
                "grc": "Ἐκθεσις φωτογραφιῶν τῆς συλλογῆς ἀπολιθωμάτων."
            }[lang],
            gallery_by_locality=gallery_by_locality,
            lang=lang,
            start_slideshow={
                "el": "Προβολή σε παρουσίαση",
                "en": "Start slideshow",
                "grc": "Εὐπαρουσίως ἰδεῖν"
            }
        )
        language_specific_file.write_text(gallery_html)
    base_file = SITE_ROOT / "gallery.html"
    base_file_template = JINJA_ENV.from_string(GALLERY_HTML_TEMPLATE)
    base_file_text = base_file_template.render(
        file_path="gallery.html",
        slideshow=True,
    )
    base_file.write_text(base_file_text)

def _count_taxa(taxonomy_info: Dict) -> int:
    """Recursively count every taxon node in the taxonomy tree."""
    n = 0
    for info in taxonomy_info.values():
        n += 1
        subtaxa = info.get("subtaxa") or {}
        if subtaxa:
            n += _count_taxa(subtaxa)
    return n


def generate_index_html():
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)

    # Stats for the homepage counters panel. Localities are counted only if
    # they have real coordinates (skips placeholders like "unknown-cyprus").
    localities = geodata["localities"]
    n_localities = sum(1 for loc in localities.values() if "coords_lat" in loc)
    n_taxa = _count_taxa(taxonomy_info)
    n_samples = len(SAMPLES)
    n_countries = len({loc["country"] for loc in localities.values()
                       if "coords_lat" in loc and loc.get("country")})

    template_html = JINJA_ENV.get_template("index.html.template")
    recent_updates = get_recently_updated_pages(10)

    index_html = template_html.render(
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
        n_localities=n_localities,
        n_taxa=n_taxa,
        n_samples=n_samples,
        n_countries=n_countries,
    )
    (SITE_ROOT / "index.html").write_text(index_html)

    template_json = JINJA_ENV.get_template("index.json.template")
    index_json = template_json.render(
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
    )
    (SITE_ROOT / "index.json").write_text(index_json)


def generate_quiz_html():
    """Generate /quiz.html — interactive taxonomy quiz. All logic runs client-side."""
    template_html = JINJA_ENV.get_template("quiz.html.template")
    (SITE_ROOT / "quiz.html").write_text(template_html.render())

    template_json = JINJA_ENV.get_template("quiz.json.template")
    (SITE_ROOT / "quiz.json").write_text(template_json.render())


def generate_acknowledgements_html():
    """Generate /acknowledgements.html — credits for PhyloPic, AI, fonts, libraries."""
    cache = enrich_phylopic_cache()

    attributions = []
    for taxon_key, entry in cache.items():
        if not entry.get("image_uuid") or not entry.get("artist"):
            continue
        attributions.append({
            "taxon_key": taxon_key,
            "taxon_name": taxon_key.replace("_", " ").title(),
            "image_uuid": entry["image_uuid"],
            "vector_url": entry["vector_url"],
            "artist": entry["artist"],
            "license_name": entry.get("license_name", ""),
            "license_url": entry.get("license_url", ""),
        })
    attributions.sort(key=lambda a: a["taxon_name"])

    template_html = JINJA_ENV.get_template("acknowledgements.html.template")
    (SITE_ROOT / "acknowledgements.html").write_text(
        template_html.render(phylopic_attributions=attributions)
    )

    template_json = JINJA_ENV.get_template("acknowledgements.json.template")
    (SITE_ROOT / "acknowledgements.json").write_text(template_json.render())


@click.command()
@click.option(
    "-v",
    "--verbose",
    count=True,
    help="Increase verbosity (-v for DEBUG, default is INFO)"
)
def main(verbose):
    """Generate site pages and content."""
    # Configure logging based on verbosity
    if verbose:
        LOGGER.setLevel(logging.DEBUG)
        logging.getLogger("pyscripts.generate_pages_json").setLevel(logging.DEBUG)
        logging.getLogger("pyscripts.site_generator.sitemap_generator").setLevel(logging.DEBUG)
    logging.basicConfig(
        format='%(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s'
    )
    
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    # Clean up old taxonomy tree files
    LOGGER.debug("Cleaning up taxonomic tree...")
    subprocess.run(["rm", "-rf", SITE_ROOT / "tree"])
    os.mkdir(SITE_ROOT / "tree")
    LOGGER.debug("Generating new taxonomic tree...")
    # tree/*/<taxon>.<html/json>
    for taxon, taxon_dict in taxonomy_info.items():
        taxon_dir = SITE_ROOT / "tree" / taxon
        taxon_dir.mkdir(parents=True, exist_ok=True)
        generate_taxonomy_tree_files(taxon_dir, taxon, taxon_dict)
    # /unclassified.html + /unclassified.json
    generate_unknown_samples_files()
    LOGGER.debug('Generated "Unclassified" page.')
    # pages.json
    generate_pages_json_main()
    LOGGER.debug('Generated "pages.json".')
    # random-sample.json
    generate_random_samples_json()
    LOGGER.debug('Generated "random_samples.json".')
    # map
    generate_map_page()
    LOGGER.debug('Generated Map page.')
    # gallery
    generate_gallery_page()
    LOGGER.debug('Generated Gallery page.')
    # generate locality pages
    generate_locality_pages()
    LOGGER.debug('Generated locality pages.')
    # generate journal entries
    build_journal()
    LOGGER.debug('Generated journal pages.')
    # generate quiz page (before sitemap so it's included)
    generate_quiz_html()
    LOGGER.debug('Generated Quiz page.')
    # generate acknowledgements page (before sitemap so it's included)
    generate_acknowledgements_html()
    LOGGER.debug('Generated Acknowledgements page.')
    # generate sitemap.xml
    sitemap_generator_main()
    LOGGER.debug('Generated Sitemap')
    # generate index.html + index.json
    generate_index_html()
    LOGGER.debug('Generated Homepage')

if __name__ == "__main__":
    main()
