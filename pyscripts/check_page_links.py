"""Fail the build if a script builds a page link without documentHref().

Every document on this site exists once per language: the default language at the site
root, the others mirrored under /<lang>/. A page URL assembled by hand in JavaScript —
`getBaseURL() + '/cookies.html'`, `` `${root}/${key}/${key}.html` `` — is therefore
always the English one, and silently drops a reader out of the language they were in.

That mistake was made independently in the search box, the Tree of Life drawer, the map
popups, the cookie banner, the random sample, the breadcrumbs and the footer, and each
one had to be found by hand. documentHref() in scripts/language.js is now the single
way to address a page, and this check keeps it that way.
"""

import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"

# Files that legitimately construct page URLs without the helper:
#   language.js  — defines documentHref itself
#   journal.js   — fetches the gallery's language fragments, which are not pages
ALLOWED = {"language.js", "journal.js"}

# Two things have to be true for a line to be wrong: it turns a URL into a link or a
# navigation, AND it builds that URL from the site root. Storing a language-neutral path
# (random-sample.js's link table) or testing one (`path.startsWith('/tree/')`) is fine —
# those are consumed by documentHref later. A relative link ("./index.html") is fine
# too, since it resolves inside whatever language directory the page is already in.
NAVIGATES = re.compile(
    r"""(?x)
      \.href\s*=                       # el.href = … / window.location.href = …
    | \blocation\.(?:assign|replace)\s*\(
    | \bhref=\\?["']?\$\{              # href="${…}" built inside a template literal
    """
)
FROM_SITE_ROOT = re.compile(
    r"""(?x)
      getBaseURL\(\)
    | ROOT_PREFIX
    | ['"`]/(?:tree|localities|journal)/
    | ['"`]/[A-Za-z0-9_-]+\.html
    """
)


def main() -> int:
    problems: list[str] = []
    for path in sorted(SCRIPTS_DIR.glob("*.js")):
        if path.name in ALLOWED:
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            code = line.split("//", 1)[0]
            if "documentHref" in code:
                continue
            if NAVIGATES.search(code) and FROM_SITE_ROOT.search(code):
                problems.append(f"  {path.name}:{lineno}: {line.strip()}")

    if problems:
        print(
            "Page links must go through documentHref() so they stay in the reader's "
            "language.\nSee scripts/language.js. Offending lines:\n"
            + "\n".join(problems),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
