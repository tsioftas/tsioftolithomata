import os
import json
import jinja2
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import TypedDict, List, Optional, Dict, Tuple, NamedTuple
from datetime import datetime
import logging

import frontmatter
from .sitemap_generator import BASE_URL
from .build_journal import main as build_journal
from . import SITE_ROOT, GLOBAL_DICT

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

    def to_dict(self):
        d = asdict(self)
        d["images_dir"] = str(self.images_dir)  # Path is not JSON serializable
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
        return [Sample._from_dict(sample_id, sample_info) for sample_id, sample_info in samples_info.items()]

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

    html_file = cwd / f"{current_taxon}.html"
    template_html = JINJA_ENV.get_template("taxon.html.template")
    taxon_html = template_html.render(
        samples_by_locality=samples_by_locality,
        dir="/" + cwd.relative_to(SITE_ROOT).as_posix(),
        root_relative_prefix="../" * len(cwd.relative_to(SITE_ROOT).parts),
        name_en=taxon_dict["name"]["en"],
        name_el=taxon_dict["name"]["el"],
        subtaxa=taxon_dict["subtaxa"],
        taxon_id=current_taxon,
        description_paragraphs=len(taxon_dict["description"]["en"]),
        meta_description=truncate_meta_description(taxon_dict["description"]["en"][0])
    )
    html_file.write_text(taxon_html)

    # assert False, taxon_dict
    json_file = cwd / f"{current_taxon}.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    taxon_json = template_json.render(
        taxon=taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        taxon_id=current_taxon,
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

    html_file = SITE_ROOT / f"unclassified.html"
    template_html = JINJA_ENV.get_template("taxon.html.template")
    taxon_html = template_html.render(
        samples_by_locality=samples_by_locality,
        dir="",
        root_relative_prefix="",
        name_en="unclassified",
        name_el="ακατηγοριοποίητα",
        subtaxa={},
        taxon_id="unclassified",
        description_paragraphs=len(unknown_taxon_dict["description"]["el"]),
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

def generate_map_page():
    # this method generates map.html page with the samples on a map
    html_file = Path("map.html")
    template_html = JINJA_ENV.get_template("map.html.template")
    with open("jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)
    taxon_html = template_html.render(
        root_relative_prefix="./",
        meta_description="A fossil collection displayed on a map.",
        geodata=geodata,
        samples_by_locality={
            locality: [
                s.to_dict() for s in locality_samples
            ] for locality, locality_samples in group_by_locality(SAMPLES).items()
        },
    )
    html_file.write_text(taxon_html)

    json_file =  Path("map.json")
    template_json = JINJA_ENV.get_template("map.json.template")
    taxon_json = template_json.render()
    json_file.write_text(taxon_json)

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
            meta_description=truncate_meta_description(localities_info[locality]["description"]["en"][0])
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
    for lang in ["el", "en", "grc"]:
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
        ignore = ["index.html", "gallery.html", "map.html"]
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
            LOGGER.info(f"Skipping ignored page: {relative_path}")
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
<head>
    <meta charset="UTF-8" >
</head>

<html lang="en">
<body>
  <div id="header-container"></div>
</body>

<div id="paste-point"></div>

<script 
    id="language-script"
    src="./scripts/language.js"
    dict="/jsondata/dict.json"
    keys=""
    galleryLength="0"
></script>

<script src="./scripts/header.js" id="header-script"></script>

<script src="https://cdn.jsdelivr.net/npm/lightgallery@2"></script>
<script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/zoom/lg-zoom.umd.js"></script>

{% if slideshow %}
<script src="./scripts/slideshow.js"></script>
{% endif %}
<script src="./scripts/journal.js" id="journal-script" file_path="{{file_path}}"></script>
<script src="./scripts/gallery.js" id="gallery-script"></script>

</html>
"""

def generate_gallery_page():
    """
    Generates gallery.html and gallery.json pages displaying all fossils in a grid.
    Images are organized by locality, with captions from samples_info.json.
    """
    # Load locality information for sorting and naming
    with open(SITE_ROOT / "jsondata/geochronology.json", "r") as f:
        geodata = json.load(f)
    localities_info = geodata["localities"]
    
    
    # Render HTML for each language dynamically
    for lang in ["el", "en", "grc"]:
        # Group images by locality
        gallery_by_locality: Dict[str, List[Dict]] = {}
        # Process each sample and extract images
        for sample in SAMPLES:
            locality_id = sample.locality
            # Use locality name if available, otherwise use the ID
            locality_name = localities_info.get(locality_id, {}).get("name", {}).get(lang, locality_id)
            if locality_name not in gallery_by_locality:
                gallery_by_locality[locality_name] = []
            
            # Add each image from the sample to the gallery
            for image in sample.images:
                thumbnail_path = f"{sample.images_dir}/thumbs_dir/{image['filename']}_thumb.jpg"
                image_path = f"{sample.images_dir}/{image['filename']}.jpg"
                webp_path = f"{sample.images_dir}/webp_dir/{image['filename']}.webp"
                gallery_by_locality[locality_name].append({
                    "thumbnail_path": thumbnail_path,
                    "image_path": image_path,
                    "webp_path": webp_path,
                    "caption": image["caption"]
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

def generate_index_html():
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    template_html = JINJA_ENV.get_template("index.html.template")
    recent_updates = get_recently_updated_pages(10)
    
    index_html = template_html.render(
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
    )
    (SITE_ROOT / "index.html").write_text(index_html)

    template_json = JINJA_ENV.get_template("index.json.template")
    index_json = template_json.render(
        taxonomy=taxonomy_info,
        recent_updates=recent_updates,
    )
    (SITE_ROOT / "index.json").write_text(index_json)

if __name__ == "__main__":
    # tree/*/<taxon>.<html/json>
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    # Clean up old taxonomy tree files
    subprocess.run(["rm", "-rf", SITE_ROOT / "tree"])
    os.mkdir(SITE_ROOT / "tree")
    for taxon, taxon_dict in taxonomy_info.items():
        taxon_dir = SITE_ROOT / "tree" / taxon
        taxon_dir.mkdir(parents=True, exist_ok=True)
        generate_taxonomy_tree_files(taxon_dir, taxon, taxon_dict)
    # /unclassified.html + /unclassified.json
    generate_unknown_samples_files()
    # pages.json
    subprocess.run(["python", SITE_ROOT / "pyscripts/generate_pages_json.py"])
    # random-sample.json
    generate_random_samples_json()
    # map
    generate_map_page()
    # gallery
    generate_gallery_page()
    # generate locality pages
    generate_locality_pages()
    # generate journal entries
    build_journal()
    # generate sitemap.xml
    subprocess.run(["python", SITE_ROOT / "pyscripts/site_generator/sitemap_generator.py"])
    # generate index.html + index.json
    generate_index_html()
