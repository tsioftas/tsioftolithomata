"""Read counts for the journal, fetched from GoatCounter at build time.

GoatCounter counts every visitor: scripts/analytics.js loads it outside the consent
gate because it sets no cookies, while GA4 only ever sees the readers who accept the
banner. Its API needs a token, so the counts are pulled once per deploy into
jsondata/journal_views.json and baked into the pages — no backend, and no
third-party request from the reader's browser.

The four language mirrors of an entry are summed into one number: a translation is
not a different article.

Run: GOATCOUNTER_API_TOKEN=... python -m pyscripts.site_generator.journal_views
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

from . import DEFAULT_LANG, LANGUAGE_CODES, SITE_ROOT

API = "https://tsioftas.goatcounter.com/api/v0"
VIEWS_FILE = SITE_ROOT / "jsondata" / "journal_views.json"

# GoatCounter reports today's numbers unless asked otherwise; this predates the
# first entry, so the count is the whole life of the article.
SINCE = "2024-01-01"

# /journal/lyme-regis-2026 and its mirrors, with or without the .html a visitor may
# have arrived by. The index itself is not an entry.
_MIRRORS = "|".join(re.escape(c) for c in LANGUAGE_CODES if c != DEFAULT_LANG)
_ENTRY_RE = re.compile(rf"^/(?:(?:{_MIRRORS})/)?journal/(?!index(?:\.html)?$)([^/]+?)(?:\.html)?$")


def entry_slug(path: str) -> str | None:
    """The base slug a GoatCounter path belongs to, or None if it is not an entry."""
    m = _ENTRY_RE.match(path)
    return m.group(1) if m else None


def _api(endpoint: str, token: str, params: dict) -> dict:
    url = f"{API}/{endpoint}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # Named, rather than left as Python-urllib: this is a build asking for
            # its own numbers, and it should be recognisable in someone's log.
            "User-Agent": "apolithomata-build (+https://apolithomata.com)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        # GoatCounter says why in the body; without it a 404 here is unreadable.
        raise urllib.error.HTTPError(
            e.url, e.code, f"{e.reason} on {endpoint}: {e.read(500).decode(errors='replace')}",
            e.headers, None,
        ) from None


def _entry_path_ids(token: str) -> dict[int, str]:
    """Every path GoatCounter knows that is a journal entry, as id -> base slug.

    Asking for the ids first keeps the counts to a single request: the stats
    endpoint would otherwise page through all ~1500 paths on the site.
    """
    ids: dict[int, str] = {}
    after = 0
    while True:
        data = _api("paths", token, {"limit": 200, "after": after})
        paths = data.get("paths") or []
        if not paths:
            break
        for p in paths:
            slug = entry_slug(p["path"])
            if slug:
                ids[p["id"]] = slug
            after = max(after, p["id"])
        if not data.get("more"):
            break
    return ids


def fetch_views(token: str) -> dict[str, int]:
    ids = _entry_path_ids(token)
    if not ids:
        return {}
    # include_paths is one comma-separated value. Passed as repeated parameters
    # GoatCounter keeps only the first, and the answer looks plausible: one row,
    # with a real count in it.
    data = _api(
        "stats/hits",
        token,
        {
            "start": SINCE,
            "limit": len(ids),
            "include_paths": ",".join(str(i) for i in ids),
        },
    )
    views: dict[str, int] = {}
    for hit in data.get("hits") or []:
        slug = ids.get(hit["path_id"])
        if slug:
            views[slug] = views.get(slug, 0) + hit["count"]
    return views


def load_views() -> dict[str, int]:
    """The last fetched counts, or nothing — a build without them simply omits them."""
    if not VIEWS_FILE.exists():
        return {}
    return json.loads(VIEWS_FILE.read_text(encoding="utf-8")).get("views", {})


def main() -> int:
    token = os.environ.get("GOATCOUNTER_API_TOKEN")
    if not token:
        print("GOATCOUNTER_API_TOKEN is not set; leaving the read counts alone.", file=sys.stderr)
        return 1
    try:
        views = fetch_views(token)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError) as e:
        print(f"Could not fetch the read counts from GoatCounter: {e}", file=sys.stderr)
        return 1
    VIEWS_FILE.write_text(
        json.dumps(
            {"fetched": date.today().isoformat(), "views": views},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Read counts for {len(views)} journal entries -> {VIEWS_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
