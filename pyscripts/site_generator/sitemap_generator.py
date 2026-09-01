import os
import re
import json
from datetime import datetime
from functools import lru_cache
import subprocess
from pathlib import Path
import logging

LOGGER = logging.getLogger(__name__)

# === CONFIG ===
from . import BASE_URL  # noqa: F401  (re-exported: generate_site imports it from here)
SITE_ROOT = "." # Assuming the script is run from the root of the site

with open("jsondata/geochronology.json", "r", encoding="utf-8") as f:
        localities = json.load(f)["localities"]
with open("jsondata/samples_info.json", "r", encoding="utf-8") as f:
        samples_info = json.load(f)
max_locality_samples = max(len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["locality"] == loc]) for loc in localities.keys())
max_taxon_samples = max(len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["lowest_taxa"] == tax or (isinstance(sample_info["lowest_taxa"], list) and tax in sample_info["lowest_taxa"])]) for tax in set(sample_info["lowest_taxa"] for sample_id, sample_info in samples_info.items() if isinstance(sample_info["lowest_taxa"], str)))

def get_taxonomy_priority(taxon: str) -> str:
    """
    Custom priority logic for taxonomy.
    priority = 0.7 if there are samples for this taxon,  otherwise 0.2.
    """
    taxon_samples = len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["lowest_taxa"] == taxon or (isinstance(sample_info["lowest_taxa"], list) and taxon in sample_info["lowest_taxa"])])
    return "0.7" if taxon_samples != 0 else "0.2"

def get_priority(filepath: str) -> str:
    """
    Stub for custom priority logic.
    You can base it on path depth, folder name, file name, etc.
    """
    if filepath == "index.html":
        return "1.0"
    elif filepath == "gallery.html":
        return "0.95"
    elif filepath.startswith("journal/"):
        return "0.9"
    elif filepath.startswith("localities/"):
        return "0.8"
    elif filepath.startswith("tree/"):
        return get_taxonomy_priority((filepath.split("/")[-1]).split(".")[0])
    elif filepath == "unclassified.html":
        return "0.5"
    elif filepath == "map.html":
        return "0.7"
    elif filepath == "acknowledgements.html":
        return "0.4"
    elif filepath == "quiz.html":
        return "0.7"
    elif filepath == "cookies.html":
        return "0.3"
    else:
        LOGGER.warning(f"No custom priority for {filepath}, using default.")
        return "0.5"

# The pages are not committed, so asking Git when one of them last changed gets no
# answer at all. The question has to be put to the data they are generated out of.
DATA_FILES = (
    "jsondata/taxonomy.json",
    "jsondata/samples_info.json",
    "jsondata/geochronology.json",
)

_COMMIT_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})T")
_QUOTED = re.compile(r'"([^"\\]+)"')


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
    )
    return result.stdout


@lru_cache(maxsize=None)
def file_last_modified_date(filepath: str) -> str:
    """The date of the last commit touching `filepath`, or "" if Git knows of none."""
    return _git("log", "-1", "--format=%cI", "--", filepath).strip()[:10]


@lru_cache(maxsize=None)
def data_key_dates() -> dict:
    """Newest commit date per quoted token appearing in the data files' diffs.

    A taxon page is dated by the commit that last edited *that taxon* rather than by
    the last edit to taxonomy.json, which would date all 200-odd of them the same day
    and leave the homepage's "recently updated" list meaningless. Walking the patches
    newest-first and keeping the first date seen for each token gives that, at the cost
    of one `git log -p` per data file — well under a second each, these files are small.

    A sample carries its taxon and its locality, so adding one to samples_info.json
    dates that taxon's and that locality's pages too, which is what a reader sees.
    """
    dates: dict[str, str] = {}
    for data_file in DATA_FILES:
        date = ""
        for line in _git("log", "--format=%cI", "-p", "--", data_file).splitlines():
            commit = _COMMIT_DATE.match(line)
            if commit:
                date = commit.group(1)
            elif date and line[:1] in "+-" and line[:3] not in ("+++", "---"):
                for token in _QUOTED.findall(line):
                    if date > dates.get(token, ""):
                        dates[token] = date
    return dates


def get_page_last_modified_date(rel_path: str) -> str:
    """When the data behind a generated page last changed, as YYYY-MM-DD."""
    name = Path(rel_path).stem
    if rel_path.startswith("journal/"):
        # A journal entry is its markdown, and that *is* committed.
        entries = sorted(Path("journal/entries").glob(f"{name}-*.md"))
        dates = [d for d in (file_last_modified_date(str(e)) for e in entries) if d]
        if dates:
            return max(dates)
    elif rel_path.startswith(("tree/", "localities/")):
        date = data_key_dates().get(name)
        if date:
            return date
    # Root pages aggregate the whole collection, and so does anything whose own key
    # never turned up in a diff: the newest edit to any of the data.
    dates = [d for d in (file_last_modified_date(f) for f in DATA_FILES) if d]
    return max(dates) if dates else datetime.today().strftime("%Y-%m-%d")

from . import LANGUAGES, DEFAULT_LANG, PARTIAL_LANGS, doc_url, lang_variants

_LANG_CODES = "|".join(re.escape(code) for code in LANGUAGES)
# A non-default language is a whole mirror of the site under its own directory, so a
# variant is recognised by its leading path segment rather than by a filename suffix.
_NON_DEFAULT = "|".join(re.escape(c) for c in LANGUAGES if c != DEFAULT_LANG)
_LANG_DIR_RE = re.compile(rf"^({_NON_DEFAULT})/")

IGNORED_FILES = {
    re.compile("^unknown-cyprus.html$"),
    # Not an address: Cloudflare Pages serves it in place of whatever was asked for.
    re.compile(r"^404\.html$"),
}

# The gallery still keeps a shell-plus-fragment scheme: gallery-el.html is a fragment
# journal.js pastes into gallery.html, not a destination of its own. The journal used to
# work the same way and no longer does — its entries are documents in the language
# mirrors now, so they are listed like any other page.
IGNORED_PATHS = {
    re.compile(rf"^gallery-({_LANG_CODES})\.html$"),
}


def is_language_variant(rel_path: str) -> bool:
    """True for a page that is a non-default-language variant of another page."""
    return bool(_LANG_DIR_RE.match(rel_path))


def variant_language(rel_path: str) -> str | None:
    """The language a path belongs to, or None for the default language."""
    match = _LANG_DIR_RE.match(rel_path)
    return match.group(1) if match else None


def default_language_path(rel_path: str) -> str:
    """The default-language path a variant mirrors."""
    return _LANG_DIR_RE.sub("", rel_path)


def hreflang_links(rel_path: str) -> str:
    """The alternate-language annotations for one page.

    Every variant of a page carries the full set, including a self-reference and an
    x-default pointing at the default language, which is what Google expects. Languages
    still marked partial in languages.json are left out: their pages render the
    untranslated marker, so they are noindex and must not be offered as alternates.

    Only variants that were actually built are declared. The gallery, the map and the
    quiz keep one URL and switch language in place, so /el/gallery and its siblings
    were never written; annotating them anyway pointed the crawler at three 404s per
    page. A page with no mirror gets no annotations at all.
    """
    variants = {
        code: path
        for code, path in lang_variants(rel_path).items()
        if (Path(SITE_ROOT) / path).exists()
    }
    if len(variants) < 2:
        return ""
    lines = [
        f'        <xhtml:link rel="alternate" hreflang="{code}" href="{BASE_URL}/{doc_url(path)}"/>'
        for code, path in variants.items()
        if code not in PARTIAL_LANGS
    ]
    lines.append(
        '        <xhtml:link rel="alternate" hreflang="x-default" '
        f'href="{BASE_URL}/{doc_url(variants[DEFAULT_LANG])}"/>'
    )
    return "\n".join(lines)

def main():
    sitemap_entries = []
    # A page and its language variants always change together, so the variants take the
    # default-language page's date. That keeps 400-odd files from all reading "modified
    # today" forever, and avoids running git log once per variant.
    lastmod_cache = {}
    # The default language sits at the site root; every other language mirrors the same
    # directories under its own prefix, so both sets of roots are walked.
    allowed_roots = ["./localities", "./tree", "./journal"]
    allowed_roots += [f"./{code}" for code in LANGUAGES if code != DEFAULT_LANG]
    for root, dirs, files in os.walk(SITE_ROOT):
        if root != "." and not any(root.startswith(p) for p in allowed_roots):
            continue
        for file in files:
            if file.endswith(".html"):
                path = os.path.join(root, file)
                rel_path = os.path.relpath(path, SITE_ROOT).replace("\\", "/")

                # Ignore sitemap.xml itself if it's in the tree
                if rel_path == "sitemap.xml":
                    continue
                if any(re.match(pattern, Path(rel_path).name) for pattern in IGNORED_FILES):
                    continue
                if any(pattern.match(rel_path) for pattern in IGNORED_PATHS):
                    continue

                # A partial language renders the untranslated marker, so its pages are
                # noindex and stay out until the translation is finished.
                if variant_language(rel_path) in PARTIAL_LANGS:
                    continue

                base_path = default_language_path(rel_path)
                if base_path not in lastmod_cache:
                    lastmod_cache[base_path] = get_page_last_modified_date(base_path)
                lastmod = lastmod_cache[base_path]
                # Priority comes from the default-language path so the existing
                # per-taxon logic keeps working for every variant.
                priority = get_priority(base_path)

                # A single-URL page declares no alternates, so it contributes no line
                # here rather than a blank one.
                alternates = hreflang_links(base_path)
                entry = f"""  <url>
        <loc>{BASE_URL}/{doc_url(rel_path)}</loc>
{alternates + chr(10) if alternates else ""}        <lastmod>{lastmod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>{priority}</priority>
    </url>"""
                sitemap_entries.append(entry)

    # Final sitemap XML
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
            xmlns:xhtml="http://www.w3.org/1999/xhtml">
    {chr(10).join(sitemap_entries)}
    </urlset>
    """

    # Write to file
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(sitemap_xml)

    LOGGER.info(f"✅ sitemap.xml generated with {len(sitemap_entries)} entries.")
