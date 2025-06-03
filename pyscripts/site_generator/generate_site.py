import json
import jinja2
from pathlib import Path
from typing import TypedDict, List, Optional, Dict

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
    subtaxa: Optional[Dict[str, "TaxonDict"]]


class SampleDict(TypedDict):
    lowest_taxa: str
    locality: str
    images_dir: str
    images: List[ImageDict]


class Sample:
    sample_id: str
    lowest_taxa: str | List[str] # There can be multiple fossils in a sample. None for unidentified samples.
    locality: str
    images_dir: Path
    images: List[ImageDict]

    @staticmethod
    def _from_dict(sample_id: str, sample_info: SampleDict) -> "Sample":
        s = Sample()
        s.sample_id = sample_id
        s.lowest_taxa = sample_info["lowest_taxa"]
        s.locality = sample_info["locality"]
        s.images_dir = Path(sample_info["images_dir"])
        s.images = sample_info["images"]
        return s

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

def demo():
    with open(SITE_ROOT / "jsondata/samples_info.json", "r") as f:
        samples_info = json.load(f)
    for sample_id, sample_info in samples_info.items():
        s = Sample._from_dict(sample_id, sample_info)
        print(f"Sample ID: {s.sample_id}, Locality: {s.locality.name}, Lowest Taxon: {s.lowest_taxa}")
        print(f"Age: {s.locality.chronology.start} - {s.locality.chronology.stop}")

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
        description_paragraphs=len(taxon_dict["description"]["el"]),
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

def generate_unknown_samples_files():
    unknown_samples = [sample for sample in SAMPLES if sample.is_unknown()]
    samples_by_locality = group_by_locality(unknown_samples)

    taxon_dict: TaxonDict = {
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
        "subtaxa": {}
    }

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
        description_paragraphs=len(taxon_dict["description"]["el"]),
    )
    html_file.write_text(taxon_html)

    # assert False, taxon_dict
    json_file = SITE_ROOT / f"unclassified.json"
    template_json = JINJA_ENV.get_template("taxon.json.template")
    taxon_json = template_json.render(
        taxon=taxon_dict,
        samples_by_locality=samples_by_locality,
        to_grc_number=greek_numeral,
        globaldict=GLOBAL_DICT,
        taxon_id="unclassified",
    )
    json_file.write_text(taxon_json)

    

if __name__ == "__main__":
    with open(SITE_ROOT / "jsondata/taxonomy.json", "r") as f:
        taxonomy_info = json.load(f)
    for taxon, taxon_dict in taxonomy_info.items():
        taxon_dir = SITE_ROOT / "tree" / taxon
        taxon_dir.mkdir(parents=True, exist_ok=True)
        generate_taxonomy_tree_files(taxon_dir, taxon, taxon_dict)
        generate_unknown_samples_files()
