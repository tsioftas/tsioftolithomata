import json
from pathlib import Path

SITE_ROOT = Path(__file__).parent.parent.parent
with open(SITE_ROOT / "jsondata/dict.json", "r") as f:
    GLOBAL_DICT = json.load(f)

# Single source of truth for the supported languages, shared with the front-end
# (scripts/language.js fetches the same file). Insertion order is the dropdown order.
with open(SITE_ROOT / "jsondata/languages.json", "r") as f:
    LANGUAGES: dict[str, dict] = json.load(f)
LANGUAGE_CODES: list[str] = list(LANGUAGES.keys())

# The language every page is pre-rendered in, so a visitor sees finished text in the
# very first paint instead of empty elements that JavaScript fills in later. It MUST
# match the fallback in getLanguage() (scripts/language.js): a visitor who has never
# picked a language gets this one, and language.js then skips its initial repaint
# because the markup already says what it would have written.
DEFAULT_LANG = "en"

COMMON_META_KEYWORDS: dict[str, list[str]] = {
    "el": ["απολιθώματα", "παλαιοντολογία", "απολιθωματοθηρία", "συλλογή απολιθωμάτων", "φυσική ιστορία"],
    "en": ["fossils", "paleontology", "fossil hunting", "fossil collection", "natural history"],
    "grc": ["ἀπολιθώματα", "παλαιοντολογία", "ἀπολιθωματοθηρία", "συλλογὴ ἀπολιθωμάτων", "φυσικὴ ἱστορία"],
    "cyp": ["απολιθώματα", "παλαιοντολογία", "συλλογή απολιθωμάτων", "φυσική ιστορία"],
}


def chrome_context(root_relative_prefix: str, breadcrumbs: list[dict] | None = None) -> dict:
    """Header/footer values for a page, resolved in DEFAULT_LANG at build time.

    Every string here used to be written by JavaScript after two extra round trips
    (templates/header.html, then dict.json), which is why pages painted headerless.
    """
    d = GLOBAL_DICT[DEFAULT_LANG]
    lang_cfg = LANGUAGES[DEFAULT_LANG]
    return {
        "root_relative_prefix": root_relative_prefix,
        "default_lang": DEFAULT_LANG,
        "breadcrumbs": breadcrumbs or [],
        "chrome": {
            "home": d["home"],
            "map": d["map"],
            "journal": d["journal"],
            "quiz": d["quiz"],
            "tree_of_life": d["tree-of-life"],
            "search_placeholder": d["search-placeholder"],
            "lang_label": lang_cfg["label"],
            "lang_thumb": lang_cfg["thumb"],
            "lang_alt": lang_cfg["alt"],
            "footer_name": d["footer-name"],
            "footer_source": d["footer-source"],
            "footer_credits": d["footer-credits"],
            "footer_cookies": d["footer-cookies"],
        },
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
