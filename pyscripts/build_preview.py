"""Assemble a preview copy of the built site for a pull request.

Why this exists
---------------
GitHub Pages serves one site per repository, and this one is the production site
at apolithomata.com, built from master. A pull request therefore has nowhere to
be looked at, which is issue #179.

A preview is a copy of the built site placed at previews/<name>/ on master, so it
is served from the production domain at a URL that works on any device with no
account, no secret and no third-party service. Two things make that affordable:

* the generated HTML addresses everything with relative prefixes, so a copy works
  unchanged at any depth; and
* images/, audio/ and journal/media/ — about 2.4 GB — are *not* copied. They are
  already on the production site, and the preview points at them there, which is
  the difference between a ~50 MB preview and a 2.4 GB one.

What that means for a reviewer: a preview shows the pages, styles, scripts and
data of the branch, and the photographs of production. A pull request that only
adds or changes photographs will not show them here.
"""
import argparse
import re
import shutil
from pathlib import Path

SITE_ROOT = Path(__file__).resolve().parent.parent

# Served from production instead of being copied.
MEDIA_DIRS = ("images", "audio", "journal/media")

# Never part of a preview: build tooling, history, and previews themselves (which
# would otherwise nest a copy inside every later copy).
EXCLUDE = {
    ".git", ".github", ".venv", "previews", "pyscripts", "node_modules",
    "__pycache__", ".gitignore", "CNAME", "install.sh", "server.py",
    "requirements.txt", "TODO.txt", "CONTRIBUTING.md", "README.md",
}

# A relative or absolute reference to something under a media directory:
#   ../../images/foo.jpg   images/foo.jpg   /audio/cyp/x.mp3
MEDIA_REF = re.compile(
    r'(?P<prefix>(?:\.\./)*/?)(?P<dir>' + "|".join(d.replace("/", r"/") for d in MEDIA_DIRS) + r')/'
)

ROBOTS_META = '<meta name="robots" content="noindex, nofollow">'


def _skip(path: Path) -> bool:
    parts = path.relative_to(SITE_ROOT).parts
    if any(p in EXCLUDE for p in parts):
        return True
    rel = "/".join(parts)
    return any(rel == d or rel.startswith(d + "/") for d in MEDIA_DIRS)


def copy_site(out_dir: Path) -> int:
    """Copy everything that is not media or tooling. Returns the file count."""
    count = 0
    for src in SITE_ROOT.rglob("*"):
        if not src.is_file() or _skip(src):
            continue
        dest = out_dir / src.relative_to(SITE_ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        count += 1
    return count


def rewrite_html(out_dir: Path, media_root: str) -> int:
    """Point every media reference at production and keep previews out of search.

    The media root is written onto <html data-media-root> as well, because some
    media URLs are built at runtime by JavaScript (a thumbnail in the drawer, a
    narration track); mediaHref in scripts/language.js reads it.
    """
    changed = 0
    for page in out_dir.rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        original = html

        html = MEDIA_REF.sub(lambda m: f"{media_root}{m.group('dir')}/", html)

        html = html.replace(
            "<html ", f'<html data-media-root="{media_root}" ', 1)

        # A preview is a copy of pages that already exist; it must not compete
        # with them in search results, and its canonical/hreflang annotations
        # point at production, which is exactly where a crawler should go.
        if "name=\"robots\"" not in html:
            html = html.replace("<head>", "<head>\n    " + ROBOTS_META, 1)

        if html != original:
            page.write_text(html, encoding="utf-8")
            changed += 1
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True,
                        help="preview directory name, e.g. pr-123")
    parser.add_argument("--media-root", default="/",
                        help="where the preview should look for images and audio "
                             "(default: the production site root)")
    parser.add_argument("--out", default=None,
                        help="parent directory (default: previews/ in the repo)")
    args = parser.parse_args()

    if not re.fullmatch(r"[A-Za-z0-9._-]+", args.name):
        parser.error("--name must be a single path segment")

    parent = Path(args.out) if args.out else SITE_ROOT / "previews"
    out_dir = parent / args.name
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    copied = copy_site(out_dir)
    rewritten = rewrite_html(out_dir, args.media_root)
    size_mb = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file()) / 1e6

    print(f"preview: {out_dir.relative_to(SITE_ROOT) if out_dir.is_relative_to(SITE_ROOT) else out_dir}")
    print(f"  files copied : {copied}")
    print(f"  html rewritten: {rewritten}")
    print(f"  size          : {size_mb:.1f} MB (media served from {args.media_root})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
