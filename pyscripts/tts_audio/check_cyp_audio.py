#!/usr/bin/env python3
"""Fail the build when the Cypriot narration does not match the text.

audio/cyp/ is generated, and generate_cyp_audio only warns on failure — so
without this a deploy can ship audio for wording the site no longer has, or no
audio at all. Run after generating the site; it reads the generated page JSON.

    python -m pyscripts.tts_audio.check_cyp_audio
"""

from __future__ import annotations

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
    "In CI: synthesis did not run or did not finish — check the generate_cyp_audio "
    "warnings in the site generation step. Locally: re-run the generator with the "
    "variety-tts environment available."
)


def main() -> int:
    paragraphs = collect_paragraphs(marker())
    manifest = load_manifest()

    stale: list[str] = []
    missing: list[str] = []
    for element_id, text in sorted(paragraphs.items()):
        entry = manifest.get(element_id)
        if entry is None:
            missing.append(f"{element_id} (no manifest entry)")
        elif entry.get("hash") != text_hash(text):
            stale.append(element_id)
        elif not (SITE_ROOT / entry["file"]).exists():
            missing.append(f"{element_id} ({entry['file']} is absent)")

    # Orphans are audio for paragraphs no longer authored: dead weight in the
    # deploy, invisible to a reader, dropped by the next synthesis run.
    orphans = sorted(set(manifest) - set(paragraphs))

    print(f"{len(paragraphs)} narratable cyp paragraphs, "
          f"{len(manifest)} manifest entries ({MANIFEST_PATH.relative_to(SITE_ROOT)}).")
    for label, ids in (("stale", stale), ("missing", missing), ("orphan", orphans)):
        for element_id in ids:
            print(f"  {label:>7}: {element_id}")

    if not stale and not missing:
        print("OK: every authored Cypriot paragraph has audio for its current text.")
        return 0

    print(f"\n{len(stale) + len(missing)} Cypriot narration file(s) out of date under "
          f"{AUDIO_DIR.relative_to(SITE_ROOT)}.\n{REGENERATE_HINT}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
