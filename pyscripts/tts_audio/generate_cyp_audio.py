#!/usr/bin/env python3
"""Pre-generate Cypriot narration audio for the site's TTS player.

The browser player (`scripts/tts.js`) reads el/en/grc aloud with the Web Speech
API, which has no Cypriot voice. The Cypriot model trained in the separate
`variety-tts` repo is a CPU ONNX (Piper/VITS) voice that cannot run in the
browser, so for `cyp` we synthesize the narration offline here and the player
streams the resulting WAV files.

Run with the *variety-tts* venv (it provides `variety_tts` + `onnxruntime`,
which the site venv does not):

    ~/projects/variety-tts/.venv/bin/python pyscripts/tts_audio/generate_cyp_audio.py

Reads the generated page JSON (`tree/**/*.json`, `localities/*.json`,
`unclassified.json`) — the same files the player reads — and for each narratable
paragraph in the `cyp` block (keys ending `-περιγραφή-N` / `-ετυμολογία-N` whose
value is real text, not the `[αμετάφραστο]` marker) writes
`audio/cyp/<element-id>.wav` plus a `manifest.json` the player looks audio up in.
Keyed by the exact DOM element ids the player reads, so the id convention lives
in one place (the site generator). Idempotent: a paragraph is re-synthesized only
when its source text changes (sha1 hash in the manifest), unless `--force`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import wave
from pathlib import Path

# variety-tts synthesis stack (only available under the variety-tts venv).
from variety_tts.backends.piper import PiperVoice
from variety_tts.varieties import get_transcriber

LOGGER = logging.getLogger("generate_cyp_audio")

# Site root = two levels up from this file (pyscripts/tts_audio/<this>).
SITE_ROOT = Path(__file__).resolve().parent.parent.parent
AUDIO_DIR = SITE_ROOT / "audio" / "cyp"
MANIFEST_PATH = AUDIO_DIR / "manifest.json"

DEFAULT_MODEL = Path.home() / "projects" / "variety-tts" / "models" / "cypriot" / "cypriot.onnx"
VARIETY = "el-cypriot"

# Paragraph ids the player narrates: <id>-περιγραφή-N (description) and
# <id>-ετυμολογία-N (etymology) on taxon/locality pages, and <slug>-p-N for
# journal entry paragraphs/list items (.journal-entry-content p / li).
NARRATABLE_RE = re.compile(r"-(περιγραφή|ετυμολογία|p)-\d+$")


def _page_json_files() -> list[Path]:
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


def _marker() -> str:
    cfg = json.loads((SITE_ROOT / "jsondata" / "languages.json").read_text(encoding="utf-8"))
    return cfg["cyp"]["marker"]


def collect_paragraphs(marker: str) -> dict[str, str]:
    """Map element-id -> Cypriot paragraph text, across every page JSON.

    Only narratable keys with real (non-marker, non-empty) text are kept.
    """
    paragraphs: dict[str, str] = {}
    for path in _page_json_files():
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
            if not text or text == marker:
                continue
            paragraphs[key] = text
    return paragraphs


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        frames = w.getnframes()
        rate = w.getframerate()
    return round(frames / rate, 3) if rate else 0.0


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description="Pre-generate Cypriot TTS audio for the site.")
    ap.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="path to <voice>.onnx")
    ap.add_argument("--force", action="store_true", help="re-synthesize even if the text is unchanged")
    args = ap.parse_args(argv)

    if not args.model.exists():
        LOGGER.error("No model at %s — export one from the variety-tts repo first.", args.model)
        return 2

    marker = _marker()
    paragraphs = collect_paragraphs(marker)
    if not paragraphs:
        LOGGER.info("No authored Cypriot paragraphs found — nothing to synthesize.")
        return 0

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    transcribe = get_transcriber(VARIETY).transcribe
    voice = PiperVoice(args.model)
    LOGGER.info("loaded %s (%d phonemes, %d Hz)", args.model.name, len(voice.id_map), voice.sample_rate)

    new_manifest: dict[str, dict] = {}
    synthesized = skipped = failed = 0

    for element_id, text in paragraphs.items():
        text_hash = hashlib.sha1(text.encode("utf-8")).hexdigest()
        wav_path = AUDIO_DIR / f"{element_id}.wav"
        prev = manifest.get(element_id)
        if not args.force and prev and prev.get("hash") == text_hash and wav_path.exists():
            new_manifest[element_id] = prev
            skipped += 1
            continue
        try:
            ir = transcribe(text)
            wav_bytes, unknown = voice.synthesize(ir)
        except Exception:  # noqa: BLE001 — one bad paragraph must not fail the run
            LOGGER.exception("  ✗ %s — synthesis failed, skipping", element_id)
            failed += 1
            continue
        if unknown:
            LOGGER.info("  ⚠ %s — phonemes the model never learned (skipped): %s", element_id, unknown)
        wav_path.write_bytes(wav_bytes)
        new_manifest[element_id] = {
            "file": f"audio/cyp/{element_id}.wav",
            "duration": _wav_duration(wav_path),
            "hash": text_hash,
        }
        synthesized += 1
        LOGGER.info("  ✓ %s (%.1fs)", element_id, new_manifest[element_id]["duration"])

    # Drop audio for paragraphs that are no longer authored.
    for stale_id in set(manifest) - set(new_manifest):
        stale_wav = AUDIO_DIR / f"{stale_id}.wav"
        if stale_wav.exists():
            stale_wav.unlink()
        LOGGER.info("  – %s removed (no longer authored)", stale_id)

    MANIFEST_PATH.write_text(
        json.dumps(new_manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    LOGGER.info("manifest: %d entries (%d new, %d unchanged, %d failed)",
                len(new_manifest), synthesized, skipped, failed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
