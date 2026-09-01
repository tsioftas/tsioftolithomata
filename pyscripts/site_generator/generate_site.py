import os
import re
import json
import functools
import html as html_lib
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
from .sitemap_generator import BASE_URL, is_language_variant
from .build_journal import main as build_journal
from . import (
    SITE_ROOT,
    GLOBAL_DICT,
    LANGUAGES,
    LANGUAGE_CODES,
    DEFAULT_LANG,
    PARTIAL_LANGS,
    chrome_context,
    doc_file,
    doc_url,
    lang_dir,
    lang_variants,
    combine_meta_keywords,
)
from ..generate_pages_json import main as generate_pages_json_main
from ..check_page_links import main as check_page_links_main
from .sitemap_generator import main as sitemap_generator_main

LOGGER = logging.getLogger(__name__)

# Maps a language code (see jsondata/languages.json) to its translation.
# A list is used for multi-line translations (i.e. descriptions); single-line
# fields (e.g. a name) use a plain str. Keys are not fixed so that adding a
# language is a data change, not a code change.
TranslationDict = Dict[str, List[str]]


class ImageDict(TypedDict):
    filename: str
    caption: TranslationDict
    # Which of the sample's lowest_taxa this photograph actually shows. A rock can
    # hold several fossils and the photographs of it vary in what they catch: of five
    # shots of a slab with an ammonite and a bivalve, some show both and some only one.
    # Absent means the photograph stands for the whole specimen, which is right for an
    # overview shot and is what every unannotated sample falls back to. The entries are
    # the sections a specimen is filed under, so a taxon key, or "unclassified" for the
    # fossil on the rock that has not been identified.
    shows: Optional[List[str]]


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
    acquisition: Optional[str] = None  # e.g. "purchased" for commercially-acquired specimens
    acquisition_details: Optional[Dict[str, str]] = None  # localized provenance note for purchased specimens

    @property
    def preview_images(self) -> List[dict]:
        """Images for the preview card: only this (sub-)sample's own photos.

        Batch-overview shots are excluded so they don't repeat across every
        sub-sample of a batch; they still appear in the lightbox via
        display_images.
        """
        return [{**img, 'images_dir': str(self.images_dir)} for img in self.images]

    @property
    def display_images(self) -> List[dict]:
        """All images for the lightbox, each with a per-image 'images_dir'.

        This sample's own photos come first, followed by any shared batch-overview
        shots as trailing context.
        """
        result = [{**img, 'images_dir': str(self.images_dir)} for img in self.images]
        for img in self.batch_images:
            result.append({**img, 'images_dir': str(self.batch_images_dir)})
        return result

    def to_dict(self):
        d = asdict(self)
        d["images_dir"] = str(self.images_dir)
        if self.batch_images_dir is not None:
            d["batch_images_dir"] = str(self.batch_images_dir)
        return d

    @property
    def section_keys(self) -> List[str]:
        """The sections this sample is filed under, as group_by_taxon names them."""
        taxa = self.lowest_taxa if isinstance(self.lowest_taxa, list) else [self.lowest_taxa]
        return [taxon or "unclassified" for taxon in taxa]

    def taxa_under(self, taxon: str) -> List[str]:
        """The sections of this sample that the section for `taxon` stands for.

        A taxon page can be an ancestor of what the specimen was identified as — a slab
        of bivalves is on the animalia page too — so the section stands for every one of
        the sample's taxa at or below it. A locality page's sections are the sample's own
        taxa, so there it comes back as the one.
        """
        if taxon == "unclassified":
            return [key for key in self.section_keys if key == "unclassified"]
        ancestors = get_taxon_ancestors()
        return [key for key in self.section_keys
                if key == taxon or taxon in ancestors.get(key, [])]

    @staticmethod
    def _from_dict(sample_id: str, sample_info: SampleDict) -> "Sample":
        return Sample(
            sample_id=sample_id,
            lowest_taxa=sample_info["lowest_taxa"],
            locality=sample_info["locality"],
            images_dir=Path(sample_info["images_dir"]),
            images=sample_info["images"],
            acquisition=sample_info.get("acquisition"),
            acquisition_details=sample_info.get("acquisition_details"),
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
                acquisition = sample_info.get("acquisition")
                acquisition_details = sample_info.get("acquisition_details")
                for i, item in enumerate(sample_info["items"], start=1):
                    samples.append(Sample(
                        sample_id=f"{sample_id}_{i}",
                        lowest_taxa=lowest_taxa,
                        locality=locality,
                        images_dir=Path(item["images_dir"]),
                        images=item["images"],
                        batch_images_dir=batch_images_dir,
                        batch_images=batch_images,
                        acquisition=acquisition,
                        acquisition_details=acquisition_details,
                    ))
            else:
                samples.append(Sample._from_dict(sample_id, sample_info))
        for sample in samples:
            sample._check_shows()
        return samples

    def _check_shows(self) -> None:
        """Every section this specimen is filed under must have a photograph of it.

        Annotating the photographs of a specimen is how a slab with two fossils stops
        showing both sets of photographs in both sections. Miss one of its taxa while
        doing it and that taxon's section would be left with an empty card, so the
        build stops here rather than shipping one.
        """
        annotated = [img for img in self.images if "shows" in img]
        if not annotated:
            return
        shown = {taxon for img in annotated for taxon in img["shows"]}
        shown.update(key for img in self.images if "shows" not in img for key in self.section_keys)
        missing = [key for key in self.section_keys if key not in shown]
        if missing:
            raise ValueError(
                f"{self.sample_id}: no photograph shows {', '.join(missing)}, "
                f"though the specimen is filed under it"
            )
        unknown = shown - set(self.section_keys)
        if unknown:
            raise ValueError(
                f"{self.sample_id}: a photograph claims to show {', '.join(sorted(unknown))}, "
                f"which the specimen is not filed under"
            )

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

def absolute_url(rel_path: str) -> str:
    """Absolute production URL for a site-root-relative path (percent-encoded)."""
    return f"{BASE_URL}/{urllib.parse.quote(rel_path)}"

SAMPLES = Sample.from_json(SITE_ROOT / "jsondata/samples_info.json")
JINJA_ENV = jinja2.Environment(
    loader=jinja2.FileSystemLoader(SITE_ROOT / "pyscripts/site_generator/templates"),
    keep_trailing_newline=True,
)

# Age quantities are formatted in one place and called from the templates, which
# each used to carry their own copy of the "X–Y million years ago" logic.
JINJA_ENV.globals["format_age"] = lambda age, lang: format_age(age, lang)
# Templates hold page paths (a taxon's "path", a recently-updated page's "url");
# doc_url turns one into the address it is served at.
JINJA_ENV.globals["doc_url"] = doc_url
# A specimen with two fossils on it is shown in two sections; each gets the
# photographs that caught its own fossil.
JINJA_ENV.globals["images_showing"] = lambda images, taxa: images_showing(images, taxa)

_LOCALITIES_INFO: Optional[Dict] = None
_TAXON_ANCESTORS: Optional[Dict[str, List[str]]] = None
_TAXON_SAMPLE_COUNTS: Optional[Dict[str, int]] = None
_TAXA_NAMES: Optional[Dict[str, Dict[str, str]]] = None


def display_names(lang: str) -> Dict[str, str]:
    """Every name a page can put on screen, in one lookup.

    Taxon names come from taxonomy.json and the rest of the interface from dict.json,
    and nothing resolves a taxon out of dict.json alone: doing so is what left a taxon
    the tree knew about but the dictionary did not — every taxon added since the names
    moved — showing its bare key in the breadcrumb trail. Mirrors the merge
    language.js performs on the browser side.
    """
    return {**build_taxa_names()[lang], **GLOBAL_DICT[lang]}


def build_breadcrumbs(
    taxon_path: List[str], page_prefix: str, lang: str = DEFAULT_LANG
) -> List[Dict]:
    """The taxon trail header.js used to derive from window.location.pathname.

    `taxon_path` is the chain of taxon keys from the top-level kingdom down to the
    page's own taxon, which is exactly the directory chain under tree/. Links point at
    the same language as the page they sit on, so a reader never falls out of their
    language by walking back up the tree.
    """
    icons = get_resolved_taxon_icons()
    d = display_names(lang)
    # A taxon a partial language has not named yet gets that language's marker, the
    # same as everywhere else it would appear. The key itself is never a label: it is
    # the English directory name, which reads as a bug in every language.
    fallback = LANGUAGES[lang].get("marker", "") if lang in PARTIAL_LANGS else ""
    return [
        {
            "key": key,
            "label": d.get(key) or fallback or key,
            "href": f"{page_prefix}tree/" + "/".join(taxon_path[: i + 1]) + f"/{key}",
            "icon": icons.get(key),
            "current": i == len(taxon_path) - 1,
        }
        for i, key in enumerate(taxon_path)
    ]


def _empty_element_pattern(key: str) -> re.Pattern:
    """Match an element carrying `id="key"` that has no content of its own.

    "No content" includes whitespace-only, because templates routinely put the closing
    tag on its own line:

        <span id="taallalt-recent" class="recent-update-title">
        </span>

    Anything with real text survives untouched, so re-running the generator is
    idempotent: a filled element no longer matches.
    """
    return re.compile(
        r'(<(?P<tag>[a-zA-Z0-9]+)(?=[\s>])[^<>]*\sid="'
        + re.escape(key)
        + r'"[^<>]*>)\s*</(?P=tag)>'
    )


def _text_element_pattern(key: str) -> re.Pattern:
    """Match an element carrying `id="key"` whose content is plain text.

    Elements that wrap further markup (the age line assembles several keyed spans of
    its own) are deliberately not matched: only a leaf whose whole body is one string
    is comparable with the translation that belongs in it.
    """
    return re.compile(
        r'<(?P<tag>[a-zA-Z0-9]+)(?=[\s>])[^<>]*\sid="'
        + re.escape(key)
        + r'"[^<>]*>(?P<body>[^<>]*)</(?P=tag)>'
    )


def prefill_translations(page_html: str, translations: Dict, lang: str) -> str:
    """Write `lang`'s text into the empty id-keyed elements of a rendered page.

    Mirrors updatePageKeys() in scripts/language.js: it fills exactly the ids listed in
    the page's own `keys` attribute, and resolves each from the page dict first, falling
    back to the shared dict.json over the taxon names derived from taxonomy.json (the
    same precedence language.js builds globalDict with) — and, for a language still
    marked partial, to that language's marker, so a gap shows up as "[αμετάφραστο]"
    rather than as blankness. Only empty elements are rewritten, so the pass is
    idempotent.
    """
    keys_attr = re.search(r'\skeys="([^"]*)"', page_html)
    if not keys_attr:
        return page_html
    lookup = {**display_names(lang), **translations}
    marker = LANGUAGES[lang].get("marker", "") if lang in PARTIAL_LANGS else ""

    for key in filter(None, keys_attr.group(1).split(",")):
        value = lookup.get(key)
        if not isinstance(value, str):
            value = marker  # empty string for a language with no gaps to mark
        if not value:
            continue
        escaped = html_lib.escape(value, quote=False)
        page_html, filled = _empty_element_pattern(key).subn(
            lambda m: f'{m.group(1)}{escaped}</{m.group("tag")}>', page_html, count=1
        )
        if not filled:
            _assert_not_frozen(page_html, key, escaped, lang)
    return page_html


def _assert_not_frozen(page_html: str, key: str, expected: str, lang: str) -> None:
    """Fail the build on a keyed element that ships text no reader will ever see fixed.

    A template that hardcodes text inside an element listed in its `keys` attribute
    used to be harmless: updatePageKeys() overwrote every one of them on load. It no
    longer does — language.js skips that repaint while the page is being read in the
    language it was generated in — so such an element is frozen at whatever the
    template happened to say, in whatever language it happened to say it. Only empty
    elements are filled here, so the mismatch is otherwise silent.
    """
    match = _text_element_pattern(key).search(page_html)
    if match is None or match.group("body").strip() == expected.strip():
        return
    raise ValueError(
        f'Element id="{key}" hardcodes "{match.group("body").strip()}" but the {lang} '
        f'translation is "{expected}". Leave the element empty in the template: '
        "prefill_translations fills it per language, and language.js no longer "
        "repaints it in the language the page was generated in."
    )


def generate_chrome_fallback_files():
    """Write templates/header.html and templates/footer.html as finished HTML.

    Every generated page now includes the chrome at build time, so nothing fetches
    these any more — except the language fragments under journal/ and the
    gallery-<lang> files, which carry an empty container so they stay viewable on
    their own. Those are served from arbitrary depths, so the links are root-absolute
    exactly as the JavaScript used to build them.
    """
    out_dir = SITE_ROOT / "templates"
    out_dir.mkdir(exist_ok=True)
    context = chrome_context("/")
    for name in ("header.html", "footer.html"):
        (out_dir / name).write_text(JINJA_ENV.get_template(name).render(**context))


def write_app_page(rel_path: str, page_html: str, json_file: Path, page_json: str) -> None:
    """Write a page that keeps one URL and switches language in place.

    The quiz holds your progress and the map holds your filters, both in memory, so
    sending the reader to a sibling URL to change language would throw that away. These
    keep the single-URL, repaint-in-place behaviour the whole site used to have. Nothing
    is lost to search: their own text is a handful of UI strings, and the localities the
    map plots each have their own page, indexed in every language.
    """
    json_file.write_text(page_json)
    translations = json.loads(page_json).get(DEFAULT_LANG, {})
    (SITE_ROOT / rel_path).write_text(
        prefill_translations(page_html, translations, DEFAULT_LANG)
    )


def write_page(
    rel_path: str,
    render_html,
    json_file: Optional[Path] = None,
    page_json: Optional[str] = None,
) -> None:
    """Write one finished HTML file per language, plus the shared translation JSON.

    `rel_path` is the default-language, site-root-relative path (e.g.
    "tree/animalia/mollusca/mollusca.html"). That file is written at the site root and
    the other languages are written into their own mirror of the same path, each
    carrying its own text, its own chrome and links that stay in-language.
    `render_html(lang)` renders the template for one language.

    The JSON is written once and shared by every language: it is what the client-side
    pieces no template can pre-render read from — lightbox captions, the sidebar tree,
    locality strings.
    """
    translations = {}
    if page_json is not None:
        json_file.write_text(page_json)
        translations = json.loads(page_json)

    for lang, variant_path in lang_variants(rel_path).items():
        out = SITE_ROOT / variant_path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(prefill_translations(render_html(lang), translations.get(lang, {}), lang))


def get_taxon_ancestors() -> Dict[str, List[str]]:
    """The ancestor chain of every taxon, including itself. Read once."""
    global _TAXON_ANCESTORS
    if _TAXON_ANCESTORS is None:
        with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
            _TAXON_ANCESTORS = build_taxon_ancestors_map(json.load(f))
    return _TAXON_ANCESTORS


def images_showing(images: List[dict], taxa: List[Optional[str]]) -> List[dict]:
    """The images that show any of `taxa`.

    An image says what it shows with a "shows" list; one that does not is an overview
    and stands for the whole specimen, so it is kept for every section. A sample whose
    photographs are not annotated at all therefore reads exactly as it did.
    """
    wanted = set(taxa)
    return [img for img in images if "shows" not in img or wanted & set(img["shows"])]


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
            "period_color": ics_period_color(info.get("age", {}).get("period")),
        }
    return out


# Epochs and sub-periods used in geochronology.json that the ICS period table
# doesn't list; each maps to the period that contains it, so every dated locality
# resolves to a colour.
@functools.lru_cache(maxsize=1)
def _ics() -> Dict:
    with open(SITE_ROOT / "jsondata/ics_periods.json", "r") as f:
        return json.load(f)


@functools.lru_cache(maxsize=1)
def ics_periods() -> List[Dict]:
    """The Phanerozoic periods, oldest first."""
    return sorted(_ics()["periods"], key=lambda p: -p["from"])


@functools.lru_cache(maxsize=1)
def ics_bands() -> List[Dict]:
    """What the chart actually draws, at the granularity the collection is dated to.

    Localities name epochs as often as periods — Pliocene, Miocene, Eocene and
    Pleistocene account for eleven of the twenty-four — so a chart of periods
    alone answers "Pliocene" with "Neogene", which is a different word for a
    different thing. Where a period is subdivided in ics_periods.json its epochs
    replace it; the rest keep their period band, which is the granularity those
    localities are dated to anyway.
    """
    epochs = _ics().get("epochs", [])
    subdivided = {e["parent"] for e in epochs}
    bands = [p for p in _ics()["periods"] if p["key"] not in subdivided] + epochs
    return sorted(bands, key=lambda b: -b["from"])


def deep_time_span(locality_ids: List[str], lang: str = DEFAULT_LANG) -> Optional[Dict]:
    """The chart of geological time to draw beside a page, cropped to its subject.

    Drawn across the whole Phanerozoic, a page's own span is a hairline: the
    Lower Jurassic of Charmouth is 9 Ma out of 539, under two percent, which
    registers as a line rather than a range. So the chart is a window around the
    span rather than the whole chart — wide enough to place it among named
    intervals, narrow enough that it reads as a width.

    Returns None when nothing in the set carries a numeric age, so the chart is
    omitted rather than drawn over a guess.
    """
    localities = get_localities_info()
    bands = ics_bands()
    total = max(b["from"] for b in bands)
    by_key = {b["key"]: b for b in bands}

    # Five localities carry a single approximate age ("about": 54.5) rather than
    # a range, and one — Taallalt — is the only locality some taxa have, so those
    # pages had no chart at all. A point is a real thing to draw: it is marked as
    # a point rather than widened into a range the data does not claim.
    bounds, points = [], []
    for loc_id in locality_ids:
        locality = localities.get(loc_id, {})
        # The "unknown locality" placeholder is recorded as 600–0 Ma, meaning "no
        # idea", and one sample filed under it stretched a taxon's span across the
        # whole chart — Bivalvia claimed 600–0 Ma on the strength of a single
        # undated shell. It is not a place, and the absence of coordinates is
        # already how the homepage counts decide that; the same test here. Its
        # specimens are still listed, they just do not date anything.
        if "coords_lat" not in locality:
            continue
        age = locality.get("age", {})
        if age.get("from") is not None and age.get("to") is not None:
            bounds.append((float(age["from"]), float(age["to"])))
        elif age.get("about") is not None:
            points.append(float(age["about"]))
        elif age.get("period") in by_key:
            # No numbers at all, but a named interval is a range: use its bounds,
            # which is exactly the precision the locality has.
            band = by_key[age["period"]]
            bounds.append((float(band["from"]), float(band["to"])))
    if not bounds and not points:
        return None

    # A page showing both kinds spans everything it knows about.
    is_point = not bounds and len(set(points)) == 1
    oldest = max([b[0] for b in bounds] + points)
    youngest = min([b[1] for b in bounds] + points)

    # The window. Snapping it to whole interval boundaries was tried first and
    # does not work: a two-million-year span inside the Miocene still ends up
    # drawn against the whole Neogene and reads as a line. The window is
    # proportional — one and a half span-widths of padding either side — which
    # puts the span at a quarter of the chart whatever its size, and the bands
    # are clipped to it. Clamped to the ends of the Phanerozoic, so a very old
    # or very recent span simply sits against one edge.
    span = oldest - youngest
    if span <= 0:
        # A single point has no width to scale a window from, so the containing
        # interval provides one: three quarters of it either side, which puts the
        # point in the middle with its neighbours named around it.
        containing = next((b for b in bands if b["from"] >= oldest >= b["to"]), None)
        reach = (containing["from"] - containing["to"]) * 0.75 if containing else total * 0.05
    else:
        reach = span * 1.5
    win_from = min(oldest + reach, total)
    win_to = max(youngest - reach, 0.0)
    win_span = win_from - win_to

    # Roughly how many characters fit in a band, for choosing a label. The chart
    # is at most 640px and the label is 9px monospace, so a character is about
    # 5.4px; two characters' worth is left as breathing room.
    chart_px = 640.0
    char_px = 5.4

    # One unit for the whole chart, chosen from its oldest end, so the two ends of
    # the same scale are never in different units. The short forms are used here
    # rather than "million years ago": these are axis labels, not sentences.
    thousands = win_from < 1.0
    unit = GLOBAL_DICT[lang].get("ka-unit" if thousands else "ma-unit", "Ma")
    scale = 1000.0 if thousands else 1.0

    def tidy(v: float) -> str:
        """201.0 → "201", 5.33 → "5.33". Ages come out of the JSON as ints and
        floats interchangeably and a trailing .0 reads as false precision."""
        return f"{v:g}"

    def scaled(v: float) -> str:
        return tidy(round(v * scale, 3 if thousands else 6))

    def scaled_edge(v: float) -> str:
        """The window's own ends, to three significant figures.

        These are not measurements — the window is the page's span plus padding —
        so printing "304.95 ka" claims a precision the number does not have. The
        interval bounds inside the chart keep their real values."""
        x = v * scale
        if x <= 0:
            return "0"
        digits = max(0, 3 - len(f"{int(x)}") if x >= 1 else 3)
        return tidy(round(x, digits))

    drawn = []
    for band in bands:
        top = min(band["from"], win_from)
        bottom = max(band["to"], win_to)
        if top <= bottom:
            continue  # entirely outside the window
        width = (top - bottom) / win_span * 100
        name = GLOBAL_DICT[lang].get(band["key"]) or band["key"].capitalize()
        budget = int(width / 100 * chart_px / char_px) - 2
        # As much of the name as fits: the whole thing, then the abbreviation,
        # then nothing rather than something clipped mid-word.
        if budget >= len(name):
            label = name
        elif budget >= len(band["abbr"]):
            label = band["abbr"]
        else:
            label = ""
        drawn.append({**band, "width": width, "label": label, "name": name,
                      "range": f"{scaled(band['from'])}–{scaled(band['to'])} {unit}"})

    return {
        "from": scaled(oldest),
        "to": scaled(youngest),
        "unit": unit,
        "is_point": is_point,
        "periods": drawn,
        "window_from": scaled_edge(win_from),
        "window_to": scaled_edge(win_to),
        "cropped": win_from < total or win_to > 0,
        "left": max((win_from - oldest) / win_span * 100, 0.0),
        "width": min(max(span, 0.0) / win_span * 100, 100.0),
    }


@functools.lru_cache(maxsize=1)
def _ics_colors() -> Dict[str, str]:
    """Every named interval's own colour: periods and epochs alike."""
    data = _ics()
    return {b["key"]: b["color"] for b in data["periods"] + data.get("epochs", [])}


def ics_period_color(period: Optional[str]) -> Optional[str]:
    """The official ICS colour for a named interval, or None if it isn't one.

    These are the International Chronostratigraphic Chart's own values, which is
    the point: on this site a colour means "when", and it is not ours to choose.
    An epoch gets its own colour rather than its period's, so a Pliocene locality
    and the Pliocene band on the chart are the same yellow. Undated or vaguely
    dated localities ("άγνωστο", "phanerozoic") get nothing rather than a
    plausible-looking guess.
    """
    if not period:
        return None
    return _ics_colors().get(period)

def group_by_locality(samples: List[Sample]) -> Dict[str, List[Sample]]:
    """Samples grouped by locality, oldest locality first.

    The order used to be whichever locality the first sample happened to belong
    to. Reading down a taxon page is reading forward through time now, which is
    the same direction the chart above it runs, and it means two taxon pages
    covering the same localities list them the same way.
    """
    locality_dict: Dict[str, List[Sample]] = {}
    for sample in samples:
        locality_name = sample.locality
        if locality_name not in locality_dict:
            locality_dict[locality_name] = []
        locality_dict[locality_name].append(sample)

    localities = get_localities_info()

    def oldest_first(loc_id: Optional[str]) -> Tuple[int, float]:
        locality = localities.get(loc_id, {}) if loc_id else {}
        age = locality.get("age", {})
        start = age.get("from", age.get("about"))
        # Undated localities sort last rather than to the beginning of time — and
        # so does the "unknown locality" placeholder, whose recorded 600 Ma would
        # otherwise put it at the top of every page it appears on as though it
        # were the oldest thing in the collection.
        if start is None or "coords_lat" not in locality:
            return (1, 0.0)
        return (0, -float(start))

    return {k: locality_dict[k] for k in sorted(locality_dict, key=oldest_first)}

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
    # cwd is tree/<kingdom>/…/<current_taxon>, so dropping "tree" leaves the ancestry
    # chain the breadcrumb trail needs.
    relative_parts = cwd.relative_to(SITE_ROOT).parts
    # Breadcrumb links stay inside the language mirror, so they measure up to the
    # language root, which is the depth of the default-language path.
    page_prefix = "../" * len(relative_parts)
    page_path = html_file.relative_to(SITE_ROOT).as_posix()

    def render_taxon(lang: str) -> str:
        return template_html.render(
            **chrome_context(
                breadcrumbs=build_breadcrumbs(list(relative_parts[1:]), page_prefix, lang),
                lang=lang,
                page_path=page_path,
            ),
            samples_by_locality=samples_by_locality,
            locality_meta=locality_meta,
            subtaxa_meta=subtaxa_meta,
            dir="/" + cwd.relative_to(SITE_ROOT).as_posix(),
            name_en=taxon_dict["name"]["en"],
            name_el=taxon_dict["name"]["el"],
            subtaxa=taxon_dict["subtaxa"],
            taxon_id=current_taxon,
            taxon_extinct=bool(taxon_dict.get("extinct", False)),
            description_paragraphs=len(taxon_dict["description"]["en"]),
            etymology_paragraphs=len(taxon_dict.get("etymology", {}).get("en", [])),
            meta_description=truncate_meta_description(taxon_dict["description"]["en"][0]),
            meta_keywords=meta_keywords_combined,
            taxon_icon=taxon_icon,
            age_span=deep_time_span(list(samples_by_locality.keys()), lang),
            n_specimens=len(taxon_samples),
            n_localities=len(samples_by_locality),
            page_url=absolute_url(page_path),
            og_image=absolute_url(f"images/thumbnails/{taxon_dict['name']['el'].capitalize()}.jpg"),
        )

    json_file = cwd / f"{current_taxon}.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    localities_info = get_localities_info()
    taxon_json = template_json.render(
        taxon=taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        languages=LANGUAGES,
        default_lang=DEFAULT_LANG,
        taxon_id=current_taxon,
        localities_info=localities_info,
        subtaxa_meta=subtaxa_meta,
        age_span=deep_time_span(list(samples_by_locality.keys())),
    )
    write_page(page_path, render_taxon, json_file, taxon_json)

    if taxon_dict["subtaxa"]:
        for sub_taxon, sub_taxon_info in taxon_dict["subtaxa"].items():
            sub_cwd = cwd / sub_taxon
            sub_cwd.mkdir(parents=True, exist_ok=True)
            generate_taxonomy_tree_files(sub_cwd, sub_taxon, sub_taxon_info)

unknown_taxon_dict: TaxonDict = {
    "name": {
        "el": "αταξινόμητα",
        "en": "unclassified",
        "grc": "ἀταξινόμητα"
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
    render_unclassified = lambda lang: template_html.render(
        **chrome_context(lang=lang, page_path="unclassified.html"),
        samples_by_locality=samples_by_locality,
        locality_meta=locality_meta,
        subtaxa_meta={},
        dir="",
        name_en="unclassified",
        name_el="αταξινόμητα",
        subtaxa={},
        taxon_id="unclassified",
        taxon_extinct=False,
        age_span=deep_time_span(list(samples_by_locality.keys()), lang),
        n_specimens=len(unknown_samples),
        n_localities=len(samples_by_locality),
        description_paragraphs=len(unknown_taxon_dict["description"]["el"]),
        etymology_paragraphs=0,
        meta_description=truncate_meta_description(unknown_taxon_dict["description"]["en"][0]),
        page_url=absolute_url("unclassified.html"),
        og_image=absolute_url("images/thumbnails/Αταξινόμητα.jpg"),
    )
    json_file = SITE_ROOT / f"unclassified.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    taxon_json = template_json.render(
        taxon=unknown_taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        languages=LANGUAGES,
        default_lang=DEFAULT_LANG,
        taxon_id="unclassified",
        localities_info=get_localities_info(),
        subtaxa_meta={},
        age_span=deep_time_span(list(samples_by_locality.keys())),
    )
    write_page("unclassified.html", render_unclassified, json_file, taxon_json)

def generate_taxa_info(cwd: Path, current_taxon: str, taxon_dict: TaxonDict) -> Dict[str, str]:
    links = {
        current_taxon: {
            "link": f"{cwd.relative_to(SITE_ROOT)}/{current_taxon}/{current_taxon}",
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
        samples = SAMPLES,
        default_lang = DEFAULT_LANG,
    )
    (SITE_ROOT / "scripts" / "random-sample.js").write_text(random_sample_js)

def build_taxa_names() -> Dict[str, Dict[str, str]]:
    """Per-language taxon display names derived from taxonomy.json.

    Untranslated (empty) names are omitted so partial languages still fall back to
    their marker.
    """
    global _TAXA_NAMES
    if _TAXA_NAMES is not None:
        return _TAXA_NAMES
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    names_by_lang: Dict[str, Dict[str, str]] = {lang: {} for lang in LANGUAGE_CODES}
    for entry in flat_taxa_list(taxonomy_info):
        for lang in LANGUAGE_CODES:
            name = entry["names"].get(lang) or ""
            if name:
                names_by_lang[lang][entry["key"]] = name.capitalize()
    _TAXA_NAMES = names_by_lang
    return _TAXA_NAMES


def generate_taxa_names_json():
    """Write per-language taxon display names derived from taxonomy.json.

    Breadcrumbs, the sidebar tree and the search box all need a taxon's name away
    from its own page. They read it from here, so taxonomy.json stays the one place
    a taxon is named and dict.json keeps to the interface.
    """
    names_by_lang = build_taxa_names()
    (SITE_ROOT / "jsondata/taxa_names.json").write_text(
        json.dumps(names_by_lang, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

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
    # "Proboscidea" the mammal order is a homonym of a myzostomid worm taxon on
    # PhyloPic, whose name filter returns the worm; query the elephant clade instead.
    "proboscidea": "Elephantimorpha",
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
        if samples and samples[0].preview_images:
            first_img = samples[0].preview_images[0]
            thumbnail = f"{first_img['images_dir']}/thumbs_dir/{first_img['filename']}_thumb.jpg"
        localities_dataset.append({
            "key": loc_id,
            "name": loc_info["name"],
            "url": f"localities/{loc_id}",
            "coords": [float(loc_info["coords_lat"]), float(loc_info["coords_lon"])],
            "country": loc_info.get("country", "unknown"),
            "age": loc_info.get("age", {}),
            "sample_count": len(samples),
            "taxa_present": compute_locality_taxa_present(samples, ancestors_map),
            "thumbnail": thumbnail,
        })

    template_html = JINJA_ENV.get_template("map.html.template")
    map_html = template_html.render(
        **chrome_context("./"),
        meta_description="A fossil collection displayed on a filterable map and geological timeline.",
        localities_dataset=json.dumps(localities_dataset, ensure_ascii=False),
        taxa_index=json.dumps(taxa_index, ensure_ascii=False),
        major_taxa=json.dumps(major_taxa, ensure_ascii=False),
        ics_periods=json.dumps(ics_periods["periods"], ensure_ascii=False),
        countries=json.dumps(geodata["countries"], ensure_ascii=False),
        taxon_icons=json.dumps(taxon_icons, ensure_ascii=False),
    )
    # map.json kept for compatibility with the language-script dict path
    template_json = JINJA_ENV.get_template("map.json.template")
    write_app_page("map.html", map_html, Path("map.json"), template_json.render(languages=LANGUAGES))


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
        taxon_info["path"] = (path / taxon / f"{taxon}.html").as_posix()
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
        # The paleo-environment reconstruction is the page's hero band. Not every
        # locality has one — "unknown locality" is a bucket, not a place — and an
        # absent one must not be rendered as a 460px band of alt text.
        hero_image_path = SITE_ROOT / f"images/localities/thumbnails/{locality}.jpg"
        template_html = JINJA_ENV.get_template("locality.html.template")
        meta_keywords_combined = combine_meta_keywords(localities_info[locality].get("meta_keywords", {}))
        render_locality = lambda lang, _t=template_html, _l=locality: _t.render(
            **chrome_context(lang=lang, page_path=f"localities/{_l}.html"),
            samples_by_taxon=samples_by_taxon,
            locality_taxonomy_info=locality_taxonomy_info,
            dir="/localities",
            name_en=localities_info[locality]["name"]["en"],
            name_el=localities_info[locality]["name"]["el"],
            loc=localities_info[locality],
            loc_id=locality,
            has_hero_image=hero_image_path.exists(),
            page_period_color=ics_period_color(
                localities_info[locality].get("age", {}).get("period")),
            age_span=deep_time_span([locality], lang),
            description_paragraphs=len(localities_info[locality]["description"]["en"]),
            meta_description=truncate_meta_description(localities_info[locality]["description"]["en"][0]),
            meta_keywords=meta_keywords_combined,
            page_url=absolute_url(f"localities/{locality}.html"),
            og_image=absolute_url(f"images/localities/thumbnails/{locality}.jpg"),
        )
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
            languages=LANGUAGES,
            default_lang=DEFAULT_LANG,
            loc_id=locality,
            age_span=deep_time_span([locality]),
        )
        write_page(f"localities/{locality}.html", render_locality, json_file, locality_json)

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
            # Partial languages (e.g. cyp) are still being translated; a missing file
            # is expected, so don't warn — the entry just won't list that language.
            if not LANGUAGES.get(lang, {}).get("partial"):
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
        # The sitemap now lists every language variant of a page. "Recently updated"
        # wants one row per page, not one per language, and the row's own text is
        # already translated through the page dict, so only the canonical page counts.
        if is_language_variant(relative_path):
            continue
        # The sitemap lists addresses; the classification below keys off the file
        # each one is served from, and `url` stays the address for the link.
        file_path = doc_file(relative_path)
        basename = os.path.basename(file_path)
        description = None
        ignore = ["index.html", "gallery.html", "map.html", "acknowledgements.html", "quiz.html", "cookies.html"]
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
            # Only list languages that actually have a name yet; a partly-translated
            # taxon (e.g. English filled, others pending) leaves the rest empty.
            title = {language: name_translation.capitalize() for language, name_translation in taxon_info.get("name", {}).items() if name_translation}
            thumbnail_base = "images/thumbnails"
            thumbnail_name = taxon_info.get("name", {}).get("el", "").capitalize()
            id = taxon_id
            # A language's description may be missing or an empty list while it awaits
            # translation; fall back to an empty string rather than indexing into [].
            description = {
                language: (taxon_info.get("description", {}).get(language) or [""])[0] for language in title.keys()
            }
        elif file_path == "unclassified.html":
            title = {language: name_translation.capitalize() for language, name_translation in unknown_taxon_dict.get("name", {}).items()}
            thumbnail_base = "images/thumbnails/"
            thumbnail_name = "Αταξινόμητα"
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
        elif file_path in ignore:
            LOGGER.debug(f"Skipping ignored page: {file_path}")
            continue
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
<html lang="{{page_lang}}" data-prerendered-lang="{{page_lang}}" data-default-lang="{{default_lang}}"
      data-site-root="{{root_relative_prefix or './'}}">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="./style.css" />
    <link rel="stylesheet" href="./scripts/gallery.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery@2/css/lightgallery.css" />
</head>
<body>
    {% include "header.html" %}
    <div id="paste-point"></div>
    <div id="footer-container">{% include "footer.html" %}</div>

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

def _num(value: float) -> str:
    """3.0 → "3", 11.7 → "11.7". Ages arrive as ints and floats interchangeably."""
    return f"{value:g}"


def format_age_quantity(from_ma: Optional[float], to_ma: Optional[float],
                        about_ma: Optional[float], lang: str) -> str:
    """An age range or estimate, in a unit that suits its size.

    Below a million years, "0.129–0.0117 million years ago" is a bad way to say
    "129 to 11.7 thousand years ago": the reader is left counting decimal places
    to work out the scale. The unit is chosen from the oldest bound, so a range
    is never expressed in two units at once, and thousands are used rather than
    plain years so no thousands separator is needed — those differ by language
    and getting them wrong is worse than not having them.
    """
    oldest = about_ma if about_ma is not None else from_ma
    if oldest is None:
        return ""
    thousands = oldest < 1.0
    unit = GLOBAL_DICT[lang].get("kya" if thousands else "mya", "")
    scale = 1000.0 if thousands else 1.0

    def q(v: float) -> str:
        return _num(round(v * scale, 3 if thousands else 6))

    if about_ma is not None:
        return f"~{q(about_ma)} {unit}"
    return f"{q(from_ma)}–{q(to_ma)} {unit}"


def format_age(age: Dict, lang: str) -> str:
    """Just the quantity part of an age dict, for templates."""
    if not age:
        return ""
    return format_age_quantity(age.get("from"), age.get("to"), age.get("about"), lang)


def _format_age_text(age: Dict, lang: str) -> str:
    """Format an age dict as '[Prefix] Period[, X-Y mya | ~X mya]'."""
    if not age:
        return ""
    parts = []
    if age.get("prefix") and age["prefix"] in GLOBAL_DICT[lang]:
        parts.append(GLOBAL_DICT[lang][age["prefix"]].capitalize())
    if age.get("period") and age["period"] in GLOBAL_DICT[lang]:
        parts.append(GLOBAL_DICT[lang][age["period"]].capitalize())
    text = " ".join(parts)
    quantity = format_age(age, lang)
    if quantity:
        text += f", {quantity}"
    return text


# The same marks the per-page lightbox captions use (see the json templates),
# kept here as constants because this caption is built in Python rather than
# Jinja. Single-quoted so they can sit inside an HTML attribute.
_MARK_PIN = ("<svg class='meta-icon' viewBox='0 0 24 24' aria-hidden='true'>"
             "<path d='M12 21.5s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z'/>"
             "<circle cx='12' cy='10.2' r='2.6'/></svg>")
_MARK_TIME = ("<svg class='meta-icon' viewBox='0 0 24 24' aria-hidden='true'>"
              "<circle cx='12' cy='12' r='8.6'/><path d='M12 7.2V12l3.2 2'/></svg>")
_MARK_CART = ("<svg class='meta-icon' viewBox='0 0 24 24' aria-hidden='true'>"
              "<path d='M3.2 4.4h2.4l2.3 10.2h9.3l2.1-7.5H7'/>"
              "<circle cx='9.5' cy='19' r='1.4'/><circle cx='16.8' cy='19' r='1.4'/></svg>")


def _build_lightbox_caption(image: Dict, sample: 'Sample', locality_info: Optional[Dict],
                             taxonomy_paths: Dict[str, str], lang: str,
                             heading: Optional[str] = None, taxon_links: bool = True,
                             section_taxon: Optional[Dict] = None) -> str:
    """Compose the data-sub-html HTML shown in the lightbox for one gallery image.

    `heading` is the "Specimen 3" line the taxon and locality pages put above the
    caption, where the images are grouped by specimen; the gallery, which shows one
    long run of photographs, passes none. `taxon_links` is off on a taxon page, where
    naming the taxon would only link the reader to the page they are already on.
    `section_taxon` is how a locality page names one instead: a specimen that carries
    two taxa is filed under both, and the caption names the section it is being read
    in rather than the whole list.
    """
    caption = image['caption'].get(lang) or LANGUAGES[lang].get('marker', '')
    parts = [f"<h2>{heading}</h2>"] if heading else []
    parts.append(f"<p>{caption}</p>")
    meta_rows: List[str] = []
    # Links out of a caption must land in the language being read. These are data
    # rather than script, so check_page_links never saw them and they pointed at
    # English from every language.
    mirror = "" if lang == DEFAULT_LANG else f"{lang}/"
    if locality_info:
        # A partial language shows its marker rather than losing the row entirely.
        loc_name = locality_info.get("name", {}).get(lang) or LANGUAGES[lang].get('marker', '')
        loc_id = sample.locality
        if loc_name and loc_id:
            meta_rows.append(
                f"<span>{_MARK_PIN} <a href='/{mirror}localities/{loc_id}'>"
                f"{loc_name}</a></span>"
            )
        age_text = _format_age_text(locality_info.get("age", {}), lang)
        if age_text:
            meta_rows.append(f"<span>{_MARK_TIME} {age_text}</span>")
    taxa = sample.lowest_taxa if isinstance(sample.lowest_taxa, list) else [sample.lowest_taxa]
    names = display_names(lang)
    if section_taxon is not None:
        section_name = section_taxon["name"].get(lang) or LANGUAGES[lang].get('marker', '')
        dagger = "†" if section_taxon.get("extinct") else ""
        meta_rows.append(
            f"<span><a href='/{mirror}{doc_url(str(section_taxon['path']))}'>"
            f"{dagger}{section_name.capitalize()}</a></span>"
        )
    for t in taxa if taxon_links else []:
        if t and t in names and t in taxonomy_paths:
            meta_rows.append(
                # No mark: a taxon name is a taxon name. The shell that was
                # here read as neither a shell nor a specimen.
                f"<span><a href='/{mirror}{doc_url(taxonomy_paths[t])}'>"
                f"{names[t].capitalize()}</a></span>"
            )
    if sample.acquisition == 'purchased':
        purchased_label = GLOBAL_DICT[lang].get('acquisition-purchased') or LANGUAGES[lang].get('marker', '')
        meta_rows.append(f"<span>{_MARK_CART} {purchased_label}</span>")
        detail = (sample.acquisition_details or {}).get(lang) or LANGUAGES[lang].get('marker', '')
        if detail:
            meta_rows.append(f"<span class='lightbox-acquisition-detail'>{detail}</span>")
    if meta_rows:
        parts.append("<div class='lightbox-meta'>" + "".join(meta_rows) + "</div>")
    # Every caller writes this into a double-quoted attribute, and the markup above is
    # built with single quotes throughout, so the only double quote that can appear is
    # one a caption was written with — which used to close the attribute early.
    return "".join(parts).replace('"', "&quot;")


def lightbox_caption(image: Dict, sample: 'Sample', lang: str, number: int,
                     taxon: Optional[Dict] = None) -> str:
    """The data-sub-html attribute for one image on a taxon or locality page.

    Called from the templates so the caption is written into the page rather than
    fetched: it used to be the only thing on those pages that needed the page's JSON,
    which meant an 84 kB download per view to fill in captions the generator already
    knew. The number is the specimen's position on the page, in Greek numerals for a
    language that asks for them.

    Each page names the half the reader does not already have: a taxon page says where
    the specimen was found, a locality page says what it is and passes `taxon`, the
    entry whose section the photograph is being read in.
    """
    lang_cfg = LANGUAGES[lang]
    counted = greek_numeral(number) if lang_cfg["grc_numbers"] else number
    return _build_lightbox_caption(
        image,
        sample,
        None if taxon is not None else get_localities_info().get(sample.locality),
        {},
        lang,
        heading=f'{lang_cfg["sample_word"]} {counted}',
        taxon_links=False,
        section_taxon=taxon,
    )


JINJA_ENV.globals["lightbox_caption"] = lightbox_caption


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
                            "acquisition": sample.acquisition,
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
                    "acquisition": sample.acquisition,
                    "lightbox_html": _build_lightbox_caption(image, sample, locality_info, taxonomy_paths, lang),
                })

        marker = LANGUAGES[lang].get("marker", "")
        language_specific_file = SITE_ROOT / f"gallery-{lang}.html"
        template_html = JINJA_ENV.get_template("gallery.html.template")
        gallery_html = template_html.render(
            root_relative_prefix="./",
            meta_description={
                "el": "Έκθεση φωτογραφιών απολιθωμάτων από τη συλλογή.",
                "en": "A gallery of fossils from the collection.",
                "grc": "Ἐκθεσις φωτογραφιῶν τῆς συλλογῆς ἀπολιθωμάτων."
            }.get(lang, marker),
            gallery_by_locality=gallery_by_locality,
            lang=lang,
            marker=marker,
            start_slideshow={
                "el": "Προβολή σε παρουσίαση",
                "en": "Start slideshow",
                "grc": "Εὐπαρουσίως ἰδεῖν",
            }.get(lang, marker),
        )
        language_specific_file.write_text(gallery_html)
    base_file = SITE_ROOT / "gallery.html"
    base_file_template = JINJA_ENV.from_string(GALLERY_HTML_TEMPLATE)
    base_file_text = base_file_template.render(
        **chrome_context("./"),
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


def _image_add_dates() -> Dict[str, str]:
    """When each file under images/ first entered the repository.

    A sample carries no date of its own — samples_info.json records what a
    specimen is, not when it was catalogued — so the date comes from the history
    of its photographs. One `git log` pass over the whole directory is enough;
    walking per sample would be 333 subprocesses. Later commits are listed
    first, so a path seen again is an earlier add and overwrites the entry,
    leaving the date the file was actually introduced.

    Returns an empty mapping when there is no usable history (a shallow clone, a
    source tarball), and the caller drops the section rather than inventing an
    order.
    """
    try:
        out = subprocess.run(
            ["git", "-c", "core.quotepath=false", "log", "--diff-filter=A",
             "--name-only", "--format=%x00%aI", "--", "images/"],
            cwd=SITE_ROOT, capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return {}
    if out.returncode != 0:
        return {}

    dates: Dict[str, str] = {}
    current = ""
    for line in out.stdout.splitlines():
        if line.startswith("\0"):
            current = line[1:].strip()
        elif line.strip() and current:
            dates[line.strip()] = current
    return dates


def get_recently_catalogued_samples(n: int) -> List[Dict]:
    """The n most recently added specimens, newest first.

    A specimen's date is the earliest add date among its photographs, so
    re-processing thumbnails years later does not make an old find look new.
    """
    add_dates = _image_add_dates()
    if not add_dates:
        return []

    dated = []
    for sample in SAMPLES:
        images = sample.preview_images
        if not images:
            continue
        stamps = [add_dates[p] for p in
                  (f"{img['images_dir']}/{img['filename']}.jpg" for img in images)
                  if p in add_dates]
        if not stamps:
            continue
        dated.append((min(stamps), sample))

    dated.sort(key=lambda pair: pair[0], reverse=True)

    # Each plate links to the specimen where it lives — its taxon page, deep-linked
    # by #sample-<id>, which share.js already knows how to open and highlight.
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    taxa_links: Dict[str, Dict] = {}
    for taxon, taxon_dict in taxonomy_info.items():
        taxa_links.update(generate_taxa_info(SITE_ROOT / "tree", taxon, taxon_dict))

    catalogued = []
    for _, sample in dated[:n]:
        images = sample.preview_images
        taxon = sample.lowest_taxa
        if isinstance(taxon, list):
            taxon = next((t for t in taxon if t), None)
        page = taxa_links.get(taxon, {}).get("link") if taxon else None
        catalogued.append({
            "sample_id": sample.sample_id,
            "href": page or "unclassified",
            "images_dir": images[0]["images_dir"],
            "filename": images[0]["filename"],
            "alt_filename": images[1]["filename"] if len(images) > 1 else None,
            "n_images": len(sample.display_images),
        })
    return catalogued


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
    # Four updated pages and eight new specimens: the specimens are the reason to
    # come back, the page list is the footnote saying what else moved.
    recent_updates = get_recently_updated_pages(4)
    recently_catalogued = get_recently_catalogued_samples(8)

    render_index = lambda lang: template_html.render(
        **chrome_context(lang=lang, page_path="index.html"),
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
        recently_catalogued=recently_catalogued,
        n_localities=n_localities,
        n_taxa=n_taxa,
        n_samples=n_samples,
        n_countries=n_countries,
        page_url=BASE_URL + "/",
        og_image=absolute_url("images/gallery.jpg"),
    )

    template_json = JINJA_ENV.get_template("index.json.template")
    index_json = template_json.render(
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
        languages=LANGUAGES,
    )
    write_page("index.html", render_index, SITE_ROOT / "index.json", index_json)


def generate_quiz_html():
    """Generate /quiz.html — interactive taxonomy quiz. All logic runs client-side."""
    template_html = JINJA_ENV.get_template("quiz.html.template")
    template_json = JINJA_ENV.get_template("quiz.json.template")
    write_app_page(
        "quiz.html",
        template_html.render(**chrome_context()),
        SITE_ROOT / "quiz.json",
        template_json.render(languages=LANGUAGES),
    )


def generate_cookies_html():
    """Generate /cookies.html — transparency page for cookies and localStorage."""
    template_html = JINJA_ENV.get_template("cookies.html.template")
    template_json = JINJA_ENV.get_template("cookies.json.template")
    write_page(
        "cookies.html",
        lambda lang: template_html.render(**chrome_context(lang=lang, page_path="cookies.html")),
        SITE_ROOT / "cookies.json",
        template_json.render(languages=LANGUAGES),
    )


def generate_404_html():
    """Generate /404.html — what Cloudflare Pages serves for an address with no file.

    With no 404.html in the deployed tree, Pages answers an unmatched address with
    index.html and a 200: a dead link returns the homepage, its relative asset paths
    resolved against whatever depth was asked for, and a crawler is told the address
    exists. Pages serves the 404.html nearest the requested path, so each language
    mirror gets its own and /el/... fails in Greek.

    Every link here is root-absolute, because the page is served at an address it
    cannot know the depth of — the same reason the chrome fallbacks in
    generate_chrome_fallback_files() are.
    """
    template_html = JINJA_ENV.get_template("404.html.template")
    template_json = JINJA_ENV.get_template("404.json.template")

    def render(lang: str) -> str:
        context = chrome_context("/", lang=lang)
        # Assets are shared, but page links stay in the mirror the reader failed in.
        context["page_prefix"] = "/" + lang_dir(lang)
        # The template declares noindex for every language, not just the partial ones,
        # so head_lang.html must not declare it a second time.
        context["page_noindex"] = False
        return template_html.render(**context)

    write_page(
        "404.html",
        render,
        SITE_ROOT / "404.json",
        template_json.render(languages=LANGUAGES),
    )


def generate_acknowledgements_html():
    """Generate /acknowledgements.html — credits for PhyloPic, AI, fonts, libraries."""
    cache = enrich_phylopic_cache()

    # The cache accumulates every taxon ever fetched, including ones later removed from
    # the taxonomy. Only credit (and emit a translation key for) taxa that still exist,
    # otherwise a removed taxon like `myliobatidae` lingers here and its untranslatable
    # key logs "Missing translation for ..." on the page.
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    valid_taxon_keys = {t["key"] for t in flat_taxa_list(taxonomy_info)}

    attributions = []
    for taxon_key, entry in cache.items():
        if taxon_key not in valid_taxon_keys:
            continue
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
    template_json = JINJA_ENV.get_template("acknowledgements.json.template")
    write_page(
        "acknowledgements.html",
        lambda lang: template_html.render(
            **chrome_context(lang=lang, page_path="acknowledgements.html"),
            phylopic_attributions=attributions,
        ),
        SITE_ROOT / "acknowledgements.json",
        template_json.render(languages=LANGUAGES),
    )


def generate_cyp_audio():
    """Synthesize any missing Cypriot narration audio (best-effort).

    The cyp TTS player streams pre-generated WAVs; the generator
    (`pyscripts/tts_audio/generate_cyp_audio.py`) reads the freshly written page
    JSON and synthesizes only paragraphs whose text changed (hash-tracked in
    `audio/cyp/manifest.json`), so re-running here is cheap and idempotent.

    Synthesis needs the *variety-tts* venv (onnxruntime + the model), not the
    site venv, so we shell out to it. If that venv is absent (e.g. a clean CI
    checkout), we log and skip rather than fail site generation — the audio
    already committed under audio/cyp/ stays valid.
    """
    py = os.environ.get("VARIETY_TTS_PYTHON") or str(
        Path.home() / "projects" / "variety-tts" / ".venv" / "bin" / "python"
    )
    script = SITE_ROOT / "pyscripts" / "tts_audio" / "generate_cyp_audio.py"
    if not Path(py).exists():
        LOGGER.warning(
            "Skipping Cypriot audio: no variety-tts venv at %s "
            "(set VARIETY_TTS_PYTHON to override).", py)
        return
    try:
        result = subprocess.run([py, str(script)], capture_output=True, text=True)
    except OSError:
        LOGGER.exception("Skipping Cypriot audio: could not launch %s", py)
        return
    if result.returncode != 0:
        LOGGER.warning("Cypriot audio generation failed (exit %d):\n%s",
                       result.returncode, result.stderr.strip())
        return
    # The generator logs its per-paragraph summary to stderr (Python logging).
    LOGGER.debug("Cypriot audio:\n%s", (result.stdout + result.stderr).strip())


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
    # templates/{header,footer}.html — the standalone fallback copies
    generate_chrome_fallback_files()
    LOGGER.debug("Generated chrome fallback files.")
    # Clean up the per-language mirrors, so a page removed from the taxonomy or a
    # language dropped from languages.json does not leave orphans behind.
    for code in LANGUAGE_CODES:
        if code != DEFAULT_LANG:
            subprocess.run(["rm", "-rf", SITE_ROOT / code])
    LOGGER.debug("Cleaned up language mirrors.")
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
    # taxa_names.json (taxon display names for breadcrumbs / sidebar tree)
    generate_taxa_names_json()
    LOGGER.debug('Generated "taxa_names.json".')
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
    # generate cookies / transparency page
    generate_cookies_html()
    LOGGER.debug('Generated Cookies page.')
    # generate acknowledgements page (before sitemap so it's included)
    generate_acknowledgements_html()
    LOGGER.debug('Generated Acknowledgements page.')
    # generate the 404 page (kept out of the sitemap: it is not an address)
    generate_404_html()
    LOGGER.debug('Generated 404 page.')
    # generate sitemap.xml
    sitemap_generator_main()
    LOGGER.debug('Generated Sitemap')
    # generate index.html + index.json
    generate_index_html()
    LOGGER.debug('Generated Homepage')
    # The homepage reads its "recently updated" list out of the sitemap, so the sitemap
    # has to be written first — which leaves the homepage itself missing from it. Write
    # it again now that every page exists. (Before per-language pages this went unnoticed:
    # index.html was picked up from the previous build, so only a first-ever build was
    # short an entry.)
    sitemap_generator_main()
    LOGGER.debug('Regenerated Sitemap with the homepage included')
    # synthesize any missing Cypriot narration audio (reads the page JSON above)
    generate_cyp_audio()
    # Every page link built in JavaScript has to go through documentHref, or it lands
    # the reader back in the default language. That went wrong independently in seven
    # places, so it is checked rather than remembered.
    if check_page_links_main() != 0:
        raise SystemExit("Page-link check failed (see above).")
    LOGGER.debug("Page links checked.")
    LOGGER.debug('Generated Cypriot audio')

if __name__ == "__main__":
    main()
