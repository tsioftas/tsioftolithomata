#!/usr/bin/env python3
"""Which Cypriot paragraphs are narratable, and what their audio is keyed by.

Shared by the two halves of the cyp narration pipeline:

  * `generate_cyp_audio.py` synthesizes the WAVs, and runs under the
    *variety-tts* venv (onnxruntime + the model).
  * `check_cyp_audio.py` verifies the committed WAVs still match the text, and
    runs in CI under the site venv, where variety-tts does not exist.

So this module is deliberately stdlib-only: importing it must never pull in the
synthesis stack.
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

# Paragraph ids the player narrates: <id>-περιγραφή-N (description) and
# <id>-ετυμολογία-N (etymology) on taxon/locality pages, and <slug>-p-N for
# journal entry paragraphs/list items (.journal-entry-content p / li).
NARRATABLE_RE = re.compile(r"-(περιγραφή|ετυμολογία|p)-\d+$")


def page_json_files() -> list[Path]:
    """The generated page JSON the player reads, in a stable order."""
    files = sorted(SITE_ROOT.glob("tree/**/*.json"))
    files += sorted(SITE_ROOT.glob("localities/*.json"))
    unclassified = SITE_ROOT / "unclassified.json"
    if unclassified.exists():
        files.append(unclassified)
    # Journal entry narration (paragraph text keyed by element id), written by
    # the site generator's build_journal step.
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
    """Map element-id -> Cypriot paragraph text, across every page JSON.

    Only narratable keys with real (non-marker, non-empty) text are kept.
    """
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
    """The committed manifest, or an empty one if the audio has never been built."""
    if not MANIFEST_PATH.exists():
        return {}
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
