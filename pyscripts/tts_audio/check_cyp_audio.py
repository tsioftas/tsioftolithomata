#!/usr/bin/env python3
"""Fail the build when the Cypriot narration does not match the text it narrates.

`audio/cyp/` is generated, not committed, and `generate_cyp_audio()` in the site
generator is best-effort by design: if the voice is missing or a paragraph fails
to synthesize, it logs a warning and lets the build continue. That is the right
behaviour locally, where a contributor without the *variety-tts* environment
should not be blocked. In CI it would mean publishing a player with audio for
wording the site no longer has — or, with nothing committed to fall back on, with
no audio at all.

This turns that into a hard failure. Run it *after* generating the site (it reads
the generated page JSON, not jsondata/) under the ordinary site venv:

    python -m pyscripts.tts_audio.check_cyp_audio

It re-derives each paragraph's sha1 the same way the synthesizer does and
compares against `audio/cyp/manifest.json`, reporting three kinds of drift:

  stale    the manifest hash disagrees with the text  -> the wrong words are read
  missing  an authored paragraph has no audio at all  -> nothing is read
  orphan   audio for a paragraph no longer authored   -> dead weight in the deploy

Only `stale` and `missing` fail: an orphan is harmless to a reader and is cleaned
up by the next synthesis run.
"""

from __future__ import annotations

import argparse
import sys

from pyscripts.tts_audio.cyp_paragraphs import (
    AUDIO_DIR,
    MANIFEST_PATH,
    SITE_ROOT,
    collect_paragraphs,
    load_manifest,
    marker,
    text_hash,
)

REGENERATE_HINT = (
    "In CI, this means synthesis did not run or did not finish: check the warnings "
    "from generate_cyp_audio in the site generation step, and that the voice was "
    "downloaded. Locally, re-run the generator with the variety-tts environment "
    "available (or `~/projects/variety-tts/.venv/bin/python "
    "pyscripts/tts_audio/generate_cyp_audio.py`)."
)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument(
        "--strict-orphans",
        action="store_true",
        help="also fail on audio for paragraphs that are no longer authored",
    )
    args = ap.parse_args(argv)

    paragraphs = collect_paragraphs(marker())
    manifest = load_manifest()

    stale: list[str] = []
    missing: list[str] = []
    for element_id, text in sorted(paragraphs.items()):
        entry = manifest.get(element_id)
        if entry is None:
            missing.append(f"{element_id} (no manifest entry)")
            continue
        if entry.get("hash") != text_hash(text):
            stale.append(element_id)
        elif not (SITE_ROOT / entry.get("file", "")).exists():
            missing.append(f"{element_id} (manifest entry, but {entry.get('file')} is absent)")

    orphans = sorted(set(manifest) - set(paragraphs))

    print(f"{len(paragraphs)} narratable cyp paragraphs, "
          f"{len(manifest)} manifest entries ({MANIFEST_PATH.relative_to(SITE_ROOT)}).")

    for label, ids in (("stale", stale), ("missing", missing), ("orphan", orphans)):
        for element_id in ids:
            print(f"  {label:>7}: {element_id}")

    failures = len(stale) + len(missing) + (len(orphans) if args.strict_orphans else 0)
    if not failures:
        if orphans:
            print(f"OK, but {len(orphans)} orphaned file(s) will be dropped by the next run.")
        else:
            print("OK: every authored Cypriot paragraph has audio for its current text.")
        return 0

    print(f"\n{failures} Cypriot narration file(s) out of date under "
          f"{AUDIO_DIR.relative_to(SITE_ROOT)}.\n{REGENERATE_HINT}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
