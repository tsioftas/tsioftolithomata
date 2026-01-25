import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from . import SITE_ROOT, GLOBAL_DICT

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
<head>
    <meta charset="UTF-8" >
</head>

<html lang="en">
<body>
  <div id="header-container"></div>
</body>

<div id="paste-point"></div>

<script 
    id="language-script"
    src="../scripts/language.js"
    dict="/jsondata/dict.json"
    keys=""
    galleryLength="0"
></script>
<script src="../scripts/header.js" id="header-script"></script>
<script id="journal-script" src="/scripts/journal.js" file_path="{{ file_path }}"></script>

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

    for md_path in sorted(entries_dir.glob("*.md")):
        post = frontmatter.load(md_path)
        meta = post.metadata

        title = require(meta, "title")
        raw_date = require(meta, "date")
        date = normalize_date(raw_date)
        category = require(meta, "category", default="")
        summary = require(meta, "summary", default="")
        lang = require(meta, "lang", default="en")

        slug = require(meta, "slug", default="")
        if not slug:
            slug = slugify(md_path.stem)

        html = build_md_to_html(post.content)

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
            )
        )

    # Sort newest first
    entries.sort(key=lambda e: e.date, reverse=True)

    out_dir.mkdir(parents=True, exist_ok=True)

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
            meta_description=e.summary,
            root_relative_prefix="../",
            dir=out_dir,
            slug=e.slug,
        )
        out_path.write_text(rendered, encoding="utf-8")
    

    journal_base_template = env.from_string(BASEHTMLTEMPLATE)
    # Generate base entry pages
    base_entries = {e.slug.removesuffix(f"-{e.lang}") for e in entries}
    for e in base_entries:
        out_path = out_dir / f"{e}.html"
        file_path = str(out_path)[str(out_path).find("/journal/")+1:]
        out_path.write_text(
            journal_base_template.render(
                file_path=file_path,
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
                    )
                )
        return filtered

    for lang in {"en", "el", "grc"}:
        index_path = out_dir / f"index-{lang}.html"
        rendered_index = tpl_index.render(
            entries=filter_entries(entries, lang),
            title=GLOBAL_DICT[lang]["journal"],
        )
        index_path.write_text(rendered_index, encoding="utf-8")
    index_path = out_dir / "index.html"
    index_path.write_text(
        journal_base_template.render(
            file_path="journal/index.html"
        )
    )
    
