import os
import json
from datetime import datetime
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

def get_git_last_modified_date(filepath: str) -> str:
    try:
        result = subprocess.run(
            ['git', 'log', '-1', '--format=%cI', filepath],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=True
        )
        iso_date = result.stdout.strip()
        if iso_date:
            return iso_date[:10]  # YYYY-MM-DD
    except subprocess.CalledProcessError:
        LOGGER.exception(f"Could not get last modified date for {filepath} using Git. Falling back to file system time.")
    # Fallback to today's date if Git fails
    return datetime.today().strftime('%Y-%m-%d')

import re
from . import LANGUAGES, DEFAULT_LANG, PARTIAL_LANGS, lang_variants

_LANG_CODES = "|".join(re.escape(code) for code in LANGUAGES)
# A non-default language is a whole mirror of the site under its own directory, so a
# variant is recognised by its leading path segment rather than by a filename suffix.
_NON_DEFAULT = "|".join(re.escape(c) for c in LANGUAGES if c != DEFAULT_LANG)
_LANG_DIR_RE = re.compile(rf"^({_NON_DEFAULT})/")

IGNORED_FILES = {
    re.compile("^unknown-cyprus.html$"),
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
    """
    variants = lang_variants(rel_path)
    lines = [
        f'        <xhtml:link rel="alternate" hreflang="{code}" href="{BASE_URL}/{path}"/>'
        for code, path in variants.items()
        if code not in PARTIAL_LANGS
    ]
    lines.append(
        '        <xhtml:link rel="alternate" hreflang="x-default" '
        f'href="{BASE_URL}/{variants[DEFAULT_LANG]}"/>'
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
        # Pull-request previews are copies of pages that are already listed here.
        # The allowed_roots test below happens to exclude them; this says so on
        # purpose, and stops walking 700 files per open preview.
        if "previews" in dirs:
            dirs.remove("previews")
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
                    lastmod_cache[base_path] = get_git_last_modified_date(
                        os.path.join(SITE_ROOT, base_path)
                    )
                lastmod = lastmod_cache[base_path]
                # Priority comes from the default-language path so the existing
                # per-taxon logic keeps working for every variant.
                priority = get_priority(base_path)

                entry = f"""  <url>
        <loc>{BASE_URL}/{rel_path}</loc>
{hreflang_links(base_path)}
        <lastmod>{lastmod}</lastmod>
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
