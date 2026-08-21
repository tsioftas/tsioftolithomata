import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import (
    SITE_ROOT,
    BASE_URL,
    GLOBAL_DICT,
    LANGUAGES,
    chrome_context,
    combine_meta_keywords,
    lang_variants,
)

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
    # The slug carries the language suffix (lyme-regis-2026-el) and is what the
    # paragraph ids are built from, which is what cyp-narration.json and the Cypriot
    # audio manifest are keyed on — so it must not change. The output path uses
    # base_slug instead, because each language now has its own directory.
    slug: str
    base_slug: str
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


# src and href cover markdown images and links; srcset covers the raw <picture> blocks
# some entries embed for their webp sources.
_MEDIA_REF_RE = re.compile(r'((?:src|href|srcset)=")(media/)')


def _retarget_media(html: str, media_base: str) -> str:
    """Point an entry's relative media references at journal/media.

    Entry markdown refers to its images as media/<slug>/…, which resolved fine while
    every entry lived directly under journal/. The language mirrors sit at a different
    depth and share the one copy of the media, so the references are rewritten to reach
    it from wherever the page is.
    """
    return _MEDIA_REF_RE.sub(lambda m: f"{m.group(1)}{media_base}media/", html)


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
                base_slug=base_slug,
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

    # Keywords per base slug, by language, for the combined meta tag.
    keywords_by_base: dict[str, dict[str, list[str]]] = {}
    for e in entries:
        if e.keywords:
            keywords_by_base.setdefault(e.base_slug, {})[e.lang] = e.keywords

    # Entry pages: one finished document per language, the default at journal/<slug>.html
    # and the rest inside their language mirror. Previously these were fragments a shell
    # fetched at runtime, which meant the prose — the most article-like content on the
    # site — was invisible to search engines in every language, English included.
    for e in entries:
        rel_path = f"journal/{e.base_slug}.html"
        ctx = chrome_context(lang=e.lang, page_path=rel_path)
        # Entry markdown refers to its images relatively (media/<slug>/…), but the media
        # lives once under journal/. From inside a language mirror that needs pointing
        # back at the site root.
        media_base = f"{ctx['root_relative_prefix']}journal/"
        rendered = tpl_entry.render(
            **ctx,
            title=e.title,
            date=e.date,
            category=e.category,
            summary=e.summary,
            content=_retarget_media(e.html, media_base),
            toc=e.toc,
            cover=f"{media_base}{e.cover}" if e.cover else "",
            meta_description=e.summary,
            meta_keywords=combine_meta_keywords(keywords_by_base.get(e.base_slug, {})),
            page_url=f"{BASE_URL}/{lang_variants(rel_path)[e.lang]}",
            og_image=f"{BASE_URL}/journal/{e.cover}" if e.cover else "",
            slug=e.slug,
            # The nav dict prefixes the label with an emoji (📝); drop it so the
            # back link reads cleanly next to its "←" arrow.
            journal_label=re.sub(
                r"^\W+", "", GLOBAL_DICT.get(e.lang, {}).get("journal") or "Journal"
            ) or "Journal",
        )
        out_path = SITE_ROOT / lang_variants(rel_path)[e.lang]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(rendered, encoding="utf-8")


    # Index: one document per language, listing that language's entries and linking to
    # them by base slug, which keeps the reader inside their own language mirror.
    for lang in GLOBAL_DICT.keys():
        rel_path = "journal/index.html"
        ctx = chrome_context(lang=lang, page_path=rel_path)
        media_base = f"{ctx['root_relative_prefix']}journal/"
        listed = [e for e in entries if e.lang == lang]
        title = GLOBAL_DICT[lang].get("journal") or LANGUAGES.get(lang, {}).get("marker", "")
        rendered_index = tpl_index.render(
            **ctx,
            entries=[
                {
                    "slug": e.base_slug,
                    "title": e.title,
                    "date": e.date,
                    "category": e.category,
                    "summary": e.summary,
                    "cover": f"{media_base}{e.cover}" if e.cover else "",
                }
                for e in listed
            ],
            title=title,
            meta_description=title,
            meta_keywords=combine_meta_keywords(
                {e.lang: e.keywords for e in listed if e.keywords}
            ),
        )
        out_path = SITE_ROOT / lang_variants(rel_path)[lang]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(rendered_index, encoding="utf-8")
    
