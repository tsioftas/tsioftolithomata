#!/usr/bin/env python3
"""Which Cypriot paragraphs are narratable, and what their audio is keyed by.

Stdlib-only on purpose: check_cyp_audio imports this and has to run without the
synthesis stack, which only generate_cyp_audio has.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

# Site root = two levels up from this file (pyscripts/tts_audio/<this>).
SITE_ROOT = Path(__file__).resolve().parent.parent.parent
AUDIO_DIR = SITE_ROOT / "audio" / "cyp"
MANIFEST_PATH = AUDIO_DIR / "manifest.json"

# Element ids the player narrates: -περιγραφή-N / -ετυμολογία-N on taxon and
# locality pages, -p-N on journal entries.
NARRATABLE_RE = re.compile(r"-(περιγραφή|ετυμολογία|p)-\d+$")


def page_json_files() -> list[Path]:
    """The generated page JSON the player reads, in a stable order."""
    files = sorted(SITE_ROOT.glob("tree/**/*.json"))
    files += sorted(SITE_ROOT.glob("localities/*.json"))
    unclassified = SITE_ROOT / "unclassified.json"
    if unclassified.exists():
        files.append(unclassified)
    # Journal narration, written by the generator's build_journal step.
    journal_narration = SITE_ROOT / "journal" / "cyp-narration.json"
    if journal_narration.exists():
        files.append(journal_narration)
    return files


def marker() -> str:
    """The `[αμετάφραστο]` placeholder cyp falls back to when a text is unwritten."""
    cfg = json.loads((SITE_ROOT / "jsondata" / "languages.json").read_text(encoding="utf-8"))
    return cfg["cyp"]["marker"]


def text_hash(text: str) -> str:
    """The manifest's identity for a paragraph's wording."""
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def collect_paragraphs(untranslated_marker: str) -> dict[str, str]:
    """Map element-id -> cyp text, keeping only narratable keys with real text."""
    paragraphs: dict[str, str] = {}
    for path in page_json_files():
        data = json.loads(path.read_text(encoding="utf-8"))
        cyp = data.get("cyp")
        if not isinstance(cyp, dict):
            continue
        for key, value in cyp.items():
            if not NARRATABLE_RE.search(key):
                continue
            if not isinstance(value, str):
                continue
            text = value.strip()
            if not text or text == untranslated_marker:
                continue
            paragraphs[key] = text
    return paragraphs


def load_manifest() -> dict[str, dict]:
    """The manifest beside the audio, or an empty one if nothing has been built yet."""
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
