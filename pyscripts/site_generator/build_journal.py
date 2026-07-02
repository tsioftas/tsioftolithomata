import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import SITE_ROOT, GLOBAL_DICT, LANGUAGES, combine_meta_keywords

import frontmatter
from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

_md = (
    MarkdownIt("commonmark", {"html": True, "linkify": True})
    .use(front_matter_plugin)
    .use(tasklists_plugin)
)

# Enable strikethrough
_md.enable("strikethrough")

def build_md_to_html(md_text: str) -> str:
    return _md.render(md_text)


# Localised label for the auto-generated table of contents.
TOC_LABEL = {
    "en": "Contents",
    "el": "Περιεχόμενα",
    "grc": "Περιεχόμενα",
    "cyp": "Περιεχόμενα",
}

_HEADING_RE = re.compile(r"<h([1-6])>(.*?)</h\1>", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


def add_toc(html: str, lang: str) -> tuple[str, str]:
    """Add unique ids to the headings of a rendered entry and build a nested
    table of contents linking to them. Returns (html_with_ids, toc_html)."""
    headings: list[tuple[int, str, str]] = []
    used: dict[str, int] = {}

    def repl(match: "re.Match[str]") -> str:
        level = int(match.group(1))
        inner = match.group(2)
        text = _TAG_RE.sub("", inner).strip()
        base = slugify(text)
        count = used.get(base, 0)
        slug = base if count == 0 else f"{base}-{count + 1}"
        used[base] = count + 1
        headings.append((level, slug, text))
        return f'<h{level} id="{slug}">{inner}</h{level}>'

    html_with_ids = _HEADING_RE.sub(repl, html)
    if not headings:
        return html, ""

    label = TOC_LABEL.get(lang, TOC_LABEL["en"])
    items = "".join(
        f'<li class="toc-h{level}"><a href="#{slug}">{text}</a></li>'
        for level, slug, text in headings
    )
    toc = (
        f'<nav class="journal-toc" aria-label="{label}">'
        f"<details open><summary>{label}</summary>"
        f"<ul>{items}</ul></details></nav>"
    )
    return html_with_ids, toc


def _inline_text(tok) -> str:
    """Plain readable text behind a markdown-it 'inline' token: link/emphasis
    labels kept, URLs and markup dropped — what the TTS voice should read."""
    parts: list[str] = []
    for child in (tok.children or []):
        if child.type in ("text", "code_inline"):
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts).strip()


def render_with_para_ids(md_text: str, slug: str) -> tuple[str, list[tuple[str, str]]]:
    """Render an entry to HTML, giving every narratable block (visible
    paragraphs and list items) a stable id, and return the plain text behind
    each id so the Cypriot TTS step can synthesize narration keyed to the same
    ids. List items carry their own direct text only; nested items get their
    own ids, so nothing is read twice."""
    tokens = _md.parse(md_text, {})
    narration: list[tuple[str, str]] = []
    n = 0
    for i, tok in enumerate(tokens):
        is_para = tok.type == "paragraph_open" and not tok.hidden
        is_item = tok.type == "list_item_open"
        if not (is_para or is_item):
            continue
        n += 1
        eid = f"{slug}-p-{n}"
        tok.attrSet("id", eid)
        text = ""
        for j in range(i + 1, min(i + 4, len(tokens))):
            tj = tokens[j]
            if tj.type == "inline":
                text = _inline_text(tj)
                break
            if tj.type in ("list_item_open", "bullet_list_open", "ordered_list_open"):
                break  # an item that opens straight into a nested list has no own text
        if text:
            narration.append((eid, text))
    html = _md.renderer.render(tokens, _md.options, {})
    return html, narration


@dataclass
class Entry:
    slug: str
    title: str
    date: str  # YYYY-MM-DD
    category: str
    summary: str
    lang: str
    html: str
    md_path: Path
    keywords: list[str]
    toc: str = ""
    cover: str = ""  # page-relative URL of the cover image, or "" if none


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-{2,}", "-", s)
    return s.strip("-") or "entry"


def require(meta: dict[str, Any], key: str, default: str = "") -> str:
    v = meta.get(key, default)
    if v is None:
        v = default
    v = str(v).strip()
    if not v and default == "":
        raise ValueError(f"Missing required front-matter field: '{key}'")
    return v


def normalize_date(raw: str) -> str:
    # Accept YYYY-MM-DD; also accept datetime-ish and reduce.
    raw = raw.strip()
    try:
        if len(raw) == 10:
            datetime.strptime(raw, "%Y-%m-%d")
            return raw
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.date().isoformat()
    except Exception:
        raise ValueError(f"Invalid date format: '{raw}' (expected YYYY-MM-DD)")

BASEHTMLTEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    {% if meta_keywords -%}
    <meta name="keywords" content="{{meta_keywords}}">
    {% endif -%}
    <link rel="stylesheet" href="/style.css" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/2.7.2/css/lightgallery.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/2.7.2/css/lg-zoom.min.css">
</head>
<body>
    <div id="header-container"></div>
    <div id="paste-point"></div>
    <div id="footer-container"></div>

    <div id="cookie-banner" style="display:none; position:fixed; bottom:0; left:0; right:0; background:#222; color:#fff; padding:1em; z-index:9999; font-size:14px; text-align:center;">
        <a id="cookie-banner-text">This site uses cookies to analyze traffic.</a>
        <button onclick="setConsent(true)" style="margin-left:1em;" id="cookie-banner-accept">Accept</button>
        <button onclick="setConsent(false)" style="margin-left:0.5em;" id="cookie-banner-decline">Decline</button>
    </div>

    <script
        id="language-script"
        src="../scripts/language.js"
        dict="/jsondata/dict.json"
        keys=""
        galleryLength="0"
    ></script>
    <script src="../scripts/sidebar.js"></script>
    <script src="../scripts/search.js"></script>
    <script src="../scripts/analytics.js"></script>
    <script src="../scripts/footer.js"></script>
    <script src="../scripts/share.js"></script>
    <script src="../scripts/header.js" id="header-script"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/2.7.2/lightgallery.min.js" integrity="sha384-MjUNxSaHL/6eoaiJXs3NcsYt5PMcFos3RjoGKaBj8wqEu0lYAn0HISvhdiF8fjec" crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lightgallery/2.7.2/plugins/zoom/lg-zoom.min.js" integrity="sha384-iqgECBkmcDeuB5f3eHKQ6uwRVFs6/4auvPpRhMS/KjpIuzgmo2W17KoMh8iGyAHy" crossorigin="anonymous"></script>
    <script src="/scripts/journal-gallery.js"></script>
    <script src="/scripts/tts.js"></script>
    <script id="journal-script" src="/scripts/journal.js" file_path="{{ file_path }}"></script>
</body>
</html>
"""


def main() -> int:
    entries_dir = SITE_ROOT / "journal" / "entries"
    out_dir = SITE_ROOT / "journal"
    templates_dir = SITE_ROOT / "pyscripts" / "site_generator" / "templates"

    if not entries_dir.exists():
        raise FileNotFoundError(f"Missing: {entries_dir}")

    env = Environment(
        loader=FileSystemLoader(str(templates_dir)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    tpl_entry = env.get_template("journal_entry.html.template")
    tpl_index = env.get_template("journal_index.html.template")

    entries: list[Entry] = []
    cyp_narration: dict[str, str] = {}  # element-id -> Cypriot text, for the TTS step

    for md_path in sorted(entries_dir.glob("*.md")):
        post = frontmatter.load(md_path)
        meta = post.metadata

        title = require(meta, "title")
        raw_date = require(meta, "date")
        date = normalize_date(raw_date)
        category = require(meta, "category", default="")
        summary = require(meta, "summary", default="")
        lang = require(meta, "lang", default="en")
        keywords: list[str] = meta["keywords"]
        if not isinstance(keywords, list) or not all(isinstance(k, str) for k in keywords):
            raise ValueError(f"'keywords' in {md_path} must be a YAML list of strings")

        slug = require(meta, "slug", default="")
        if not slug:
            slug = slugify(md_path.stem)

        # Cover image, by convention at journal/media/<base-slug>/webp_dir/cover.webp.
        # The page-relative URL is the same whether referenced from an entry page
        # or an index page, since both live directly under journal/.
        base_slug = slug.removesuffix(f"-{lang}")
        cover_rel = f"media/{base_slug}/webp_dir/cover.webp"
        cover = cover_rel if (out_dir / cover_rel).exists() else ""

        html, narration = render_with_para_ids(post.content, slug)
        html, toc = add_toc(html, lang)
        if lang == "cyp":
            cyp_narration.update(dict(narration))

        entries.append(
            Entry(
                slug=slug,
                title=title,
                date=date,
                category=category,
                summary=summary,
                lang=lang,
                html=html,
                md_path=md_path,
                keywords=keywords,
                toc=toc,
                cover=cover,
            )
        )

    # Sort newest first
    entries.sort(key=lambda e: e.date, reverse=True)

    out_dir.mkdir(parents=True, exist_ok=True)

    # Cypriot narration source for the offline TTS step (generate_cyp_audio.py),
    # keyed by the same element ids the player reads on the page.
    (out_dir / "cyp-narration.json").write_text(
        json.dumps({"cyp": cyp_narration}, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    # Generate localised entry pages
    for e in entries:
        out_path = out_dir / f"{e.slug}.html"
        rendered = tpl_entry.render(
            title=e.title,
            date=e.date,
            category=e.category,
            summary=e.summary,
            lang=e.lang,
            content=e.html,
            toc=e.toc,
            cover=e.cover,
            meta_description=e.summary,
            root_relative_prefix="../",
            dir=out_dir,
            slug=e.slug,
            # The nav dict prefixes the label with an emoji (📝); drop it so the
            # back link reads cleanly next to its "←" arrow.
            journal_label=re.sub(
                r"^\W+", "", GLOBAL_DICT.get(e.lang, {}).get("journal") or "Journal"
            ) or "Journal",
        )
        out_path.write_text(rendered, encoding="utf-8")
    

    journal_base_template = env.from_string(BASEHTMLTEMPLATE)
    # Generate base entry pages
    base_entries = {e.slug.removesuffix(f"-{e.lang}") for e in entries}
    # Collect keywords per base slug, by language
    keywords_by_base: dict[str, dict[str, list[str]]] = {}
    for e in entries:
        base = e.slug.removesuffix(f"-{e.lang}")
        if e.keywords:
            keywords_by_base.setdefault(base, {})[e.lang] = e.keywords
    for e in base_entries:
        out_path = out_dir / f"{e}.html"
        file_path = str(out_path)[str(out_path).find("/journal/")+1:]
        meta_keywords_combined = combine_meta_keywords(keywords_by_base.get(e, {}))
        out_path.write_text(
            journal_base_template.render(
                file_path=file_path,
                meta_keywords=meta_keywords_combined,
            )
        )


    # Generate index
    def filter_entries(entries: list[Entry], lang: str) -> list[Entry]:
        """
        Filter entries by language and modify slugs to base slugs.
        
        :param entries: a list of Entry objects
        :type entries: list[Entry]
        :param lang: language code to filter by
        :type lang: str
        :return: a list of filtered Entry objects with modified slugs
        :rtype: list[Entry]
        """
        filtered = []
        for e in entries:
            if e.lang == lang:
                new_slug = e.slug.replace(f"-{e.lang}", "")
                filtered.append(
                    Entry(
                        slug=new_slug,
                        title=e.title,
                        date=e.date,
                        category=e.category,
                        summary=e.summary,
                        lang=e.lang,
                        html=e.html,
                        md_path=e.md_path,
                        keywords=e.keywords,
                        cover=e.cover,
                    )
                )
        return filtered

    for lang in GLOBAL_DICT.keys():
        index_path = out_dir / f"index-{lang}.html"
        title = GLOBAL_DICT[lang].get("journal") or LANGUAGES.get(lang, {}).get("marker", "")
        rendered_index = tpl_index.render(
            entries=filter_entries(entries, lang),
            title=title,
        )
        index_path.write_text(rendered_index, encoding="utf-8")
    index_path = out_dir / "index.html"
    index_path.write_text(
        journal_base_template.render(
            file_path="journal/index.html"
        )
    )
    
