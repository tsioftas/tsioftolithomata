import json
from pathlib import Path
from urllib.parse import quote

SITE_ROOT = Path(__file__).parent.parent.parent
BASE_URL = "https://apolithomata.com"
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

# Languages whose translations are still incomplete render the "[αμετάφραστο]" marker
# in place of missing strings, so their pages are built but kept out of the sitemap and
# marked noindex. Finishing a translation is then a data change in languages.json.
PARTIAL_LANGS: set[str] = {code for code, cfg in LANGUAGES.items() if cfg.get("partial")}


def lang_dir(lang: str) -> str:
    """Directory prefix for a language: "" for the default, "el/" for the rest.

    The default language lives at the site root, so every URL that has ever been
    published stays valid and is the canonical/x-default page. Each other language gets
    a mirror of the whole tree under its own directory, which is the structure Google
    documents for multilingual sites. Because the mirror has the same shape, an ordinary
    relative link inside it stays in the same language without anything being rewritten.
    """
    return "" if lang == DEFAULT_LANG else f"{lang}/"


def lang_variants(rel_path: str) -> dict[str, str]:
    """Map every language to its variant of a site-root-relative .html path.

    `rel_path` is the default-language page, e.g. "tree/animalia/mollusca/mollusca.html".
    Used for the hreflang annotations, the language switcher and the sitemap, so all
    three are generated from one definition and cannot drift apart.
    """
    return {code: f"{lang_dir(code)}{rel_path}" for code in LANGUAGES}


def _up(levels: int) -> str:
    return "../" * levels

COMMON_META_KEYWORDS: dict[str, list[str]] = {
    "el": ["απολιθώματα", "παλαιοντολογία", "απολιθωματοθηρία", "συλλογή απολιθωμάτων", "φυσική ιστορία"],
    "en": ["fossils", "paleontology", "fossil hunting", "fossil collection", "natural history"],
    "grc": ["ἀπολιθώματα", "παλαιοντολογία", "ἀπολιθωματοθηρία", "συλλογὴ ἀπολιθωμάτων", "φυσικὴ ἱστορία"],
    "cyp": ["απολιθώματα", "παλαιοντολογία", "συλλογή απολιθωμάτων", "φυσική ιστορία"],
}


def chrome_context(
    root_relative_prefix: str = "",
    breadcrumbs: list[dict] | None = None,
    lang: str = DEFAULT_LANG,
    page_path: str | None = None,
) -> dict:
    """Header/footer values for a page, resolved in `lang` at build time.

    Every string here used to be written by JavaScript after two extra round trips
    (templates/header.html, then dict.json), which is why pages painted headerless.

    `page_path` is the default-language, site-root-relative path of the page being
    rendered; it produces the hreflang alternates, which double as the data the
    language switcher navigates by.
    """
    d = GLOBAL_DICT[lang]
    lang_cfg = LANGUAGES[lang]
    alternates: list[dict] = []
    canonical_url = xdefault_url = None
    # Pages need two different ways up. Assets (style.css, images/, scripts/) exist once
    # at the site root, while page links must stay inside the language mirror, and from
    # /el/tree/animalia/mollusca/ those are different distances.
    page_prefix = root_relative_prefix
    if page_path:
        depth = page_path.count("/")
        page_prefix = _up(depth)
        root_relative_prefix = _up(depth + (0 if lang == DEFAULT_LANG else 1))
        variants = lang_variants(page_path)
        # hreflang annotations have to be fully-qualified, while the switcher menu is
        # relative so it works on the dev server too; both come from the same mapping.
        alternates = [
            {
                "lang": code,
                "href": root_relative_prefix + path,
                "abs_href": f"{BASE_URL}/{quote(path)}",
                "label": LANGUAGES[code]["label"],
                "thumb": LANGUAGES[code]["thumb"],
                "alt": LANGUAGES[code]["alt"],
            }
            for code, path in variants.items()
        ]
        # Each variant is its own canonical; x-default sends everyone else to the
        # default language.
        canonical_url = f"{BASE_URL}/{quote(variants[lang])}"
        xdefault_url = f"{BASE_URL}/{quote(variants[DEFAULT_LANG])}"
    return {
        # To the site root: for assets, which exist once and are shared by all languages.
        "root_relative_prefix": root_relative_prefix,
        # To this language's root: for links to other pages, which must stay in-language.
        "page_prefix": page_prefix,
        "default_lang": DEFAULT_LANG,
        "page_lang": lang,
        "page_noindex": lang in PARTIAL_LANGS,
        # `alternates` is the switcher menu: every language a reader may choose,
        # partial ones included. `indexable_alternates` is what goes in the hreflang
        # annotations — a partial language is noindex, so offering it to a crawler as
        # an alternate would contradict that.
        "alternates": alternates,
        "indexable_alternates": [a for a in alternates if a["lang"] not in PARTIAL_LANGS],
        "canonical_url": canonical_url,
        "xdefault_url": xdefault_url,
        "breadcrumbs": breadcrumbs or [],
        "chrome": {
            "home": d["home"],
            "map": d["map"],
            "journal": d["journal"],
            "quiz": d["quiz"],
            "tree_of_life": d["tree-of-life"],
            "search_placeholder": d["search-placeholder"],
            # Both palette labels are rendered so the drawer button can be
            # relabelled on click without a round trip to dict.json.
            "theme_dark": d["theme-dark"],
            "theme_light": d["theme-light"],
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
