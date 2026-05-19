import json
from pathlib import Path

SITE_ROOT = Path(__file__).parent.parent.parent
with open(SITE_ROOT / "jsondata/dict.json", "r") as f:
    GLOBAL_DICT = json.load(f)

COMMON_META_KEYWORDS: dict[str, list[str]] = {
    "el": ["απολιθώματα", "παλαιοντολογία", "απολιθωματοθηρία", "συλλογή απολιθωμάτων", "φυσική ιστορία"],
    "en": ["fossils", "paleontology", "fossil hunting", "fossil collection", "natural history"],
    "grc": ["ἀπολιθώματα", "παλαιοντολογία", "ἀπολιθωματοθηρία", "συλλογὴ ἀπολιθωμάτων", "φυσικὴ ἱστορία"],
}


def combine_meta_keywords(specific: dict[str, list[str]]) -> str:
    """Combine page-specific meta_keywords with site-wide common keywords. Ensures uniqueness."""
    parts: set[str] = set()
    
    all_specific = []
    for kws in specific.values():
        all_specific.extend(kws)
    parts.update(all_specific)

    all_common = []
    for kws in COMMON_META_KEYWORDS.values():
        all_common.extend(kws)
    parts.update(all_common)
    return ", ".join(sorted(parts))
