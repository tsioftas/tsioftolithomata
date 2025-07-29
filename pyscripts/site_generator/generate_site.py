import os
import json
import jinja2
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import TypedDict, List, Optional, Dict, Tuple

from . import SITE_ROOT, GLOBAL_DICT

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

        html_file = Path(f"localities/{locality}.html")
        if not html_file.exists():
            html_file.touch()
        template_html = JINJA_ENV.get_template("locality.html.template")
        locality_html = template_html.render(
            samples_by_taxon=group_by_taxon(samples),
            taxonomy_info=taxonomy_info,
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
            loc=localities_info[locality],
            samples=samples,
            to_grc_number=greek_numeral,
            globaldict=GLOBAL_DICT,
            loc_id=locality,
        )
        json_file.write_text(locality_json)

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
    # generate locality pages
    generate_locality_pages()
    # generate sitemap.xml
    subprocess.run(["python", SITE_ROOT / "pyscripts/site_generator/sitemap_generator.py"])
    
