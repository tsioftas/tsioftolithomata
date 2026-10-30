"""Atom feeds of what is new on the site, one per language: <lang dir>/feed.xml.

generate_site collects the items; this module dates them from git history and
writes the feeds. An item goes into a language's feed only once its page in
that language is finished, i.e. renders no untranslated marker.
"""
import logging
import re
import subprocess
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional
from urllib.parse import quote

from . import BASE_URL, LANGUAGES, SITE_ROOT, GLOBAL_DICT, doc_url, feed_path, lang_variants

LOGGER = logging.getLogger(__name__)

ATOM_NS = "http://www.w3.org/2005/Atom"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
# Readers fetch the whole file on every poll; older items are already read.
FEED_LENGTH = 50

ET.register_namespace("", ATOM_NS)


@dataclass
class FeedItem:
    page: str  # default-language, site-root-relative .html path
    date: str  # RFC 3339
    titles: Dict[str, str]
    summaries_html: Dict[str, str] = field(default_factory=dict)
    fragment: str = ""  # anchor within the page, e.g. a specimen
    image: Optional[str] = None  # site-root-relative path


def feed_url(lang: str) -> str:
    return f"{BASE_URL}/{feed_path(lang)}"


_OBJECT_KEY = re.compile(r'"([^"\\]+)"\s*:\s*\{')


@lru_cache(maxsize=None)
def key_add_dates(data_file: str) -> Dict[str, str]:
    """When each object key (taxon, locality) first appeared in a JSON data file.

    Commits come newest first, so the last date written for a key is its oldest.
    """
    out = subprocess.run(
        ["git", "log", "--follow", "--format=%x00%cI", "-p", "--", data_file],
        cwd=SITE_ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout
    dates: Dict[str, str] = {}
    date = ""
    for line in out.splitlines():
        if line.startswith("\0"):
            date = line[1:].strip()
        elif date and line.startswith("+") and not line.startswith("+++"):
            for key in _OBJECT_KEY.findall(line):
                dates[key] = date
    return dates


def _tag(lang: str) -> str:
    """The standard language tag; "cyp" is a site code, not an ISO 639 one."""
    return LANGUAGES[lang].get("tag", lang)


def _url(path: str, fragment: str = "") -> str:
    return f"{BASE_URL}/{quote(doc_url(path))}" + (f"#{fragment}" if fragment else "")


@lru_cache(maxsize=None)
def _is_finished(page: str, lang: str) -> bool:
    """The page exists in `lang` and shows no untranslated marker."""
    path = SITE_ROOT / lang_variants(page)[lang]
    if not path.exists():
        return False
    marker = LANGUAGES[lang].get("marker")
    return not marker or marker not in path.read_text(encoding="utf-8")


def _sub(parent: ET.Element, tag: str, text: Optional[str] = None, **attrs) -> ET.Element:
    el = ET.SubElement(parent, f"{{{ATOM_NS}}}{tag}", attrs)
    if text is not None:
        el.text = text
    return el


def _entry(feed: ET.Element, item: FeedItem, lang: str) -> None:
    entry = _sub(feed, "entry")
    url = _url(lang_variants(item.page)[lang], item.fragment)
    _sub(entry, "id", url)
    _sub(entry, "title", item.titles[lang])
    _sub(entry, "updated", item.date)
    _sub(entry, "link", rel="alternate", type="text/html", hreflang=_tag(lang), href=url)
    # The same item in the other languages it is finished in.
    for other, path in lang_variants(item.page).items():
        if other != lang and item.titles.get(other) and _is_finished(item.page, other):
            _sub(entry, "link", rel="alternate", type="text/html", hreflang=_tag(other),
                 href=_url(path, item.fragment))
    html = f'<p><img src="{_url(item.image)}" alt=""></p>' if item.image else ""
    if item.summaries_html.get(lang):
        html += f"<p>{item.summaries_html[lang]}</p>"
    if html:
        _sub(entry, "content", html, type="html")


def write_feeds(items: List[FeedItem]) -> None:
    for lang in LANGUAGES:
        entries = [i for i in items if i.titles.get(lang) and _is_finished(i.page, lang)]
        entries.sort(key=lambda i: i.date, reverse=True)
        entries = entries[:FEED_LENGTH]

        d = GLOBAL_DICT[lang]
        feed = ET.Element(f"{{{ATOM_NS}}}feed", {XML_LANG: _tag(lang)})
        _sub(feed, "id", feed_url(lang))
        _sub(feed, "title", d["site-name"])
        _sub(feed, "link", rel="self", type="application/atom+xml", href=feed_url(lang))
        _sub(feed, "link", rel="alternate", type="text/html",
             href=_url(lang_variants("index.html")[lang]))
        _sub(feed, "updated", entries[0].date if entries else "1970-01-01T00:00:00Z")
        author = _sub(feed, "author")
        _sub(author, "name", d["footer-name"])
        _sub(feed, "icon", f"{BASE_URL}/favicon.ico")
        for item in entries:
            _entry(feed, item, lang)

        ET.indent(feed)
        out = SITE_ROOT / feed_path(lang)
        out.parent.mkdir(parents=True, exist_ok=True)
        ET.ElementTree(feed).write(out, encoding="utf-8", xml_declaration=True)
        LOGGER.info(f"{feed_path(lang)}: {len(entries)} entries")
