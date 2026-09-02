#!/usr/bin/env python3
"""Pre-generate Cypriot narration audio for the site's TTS player.

The player reads el/en/grc with the Web Speech API, which has no Cypriot voice,
so cyp is synthesized offline and streamed as WAVs. Writes
`audio/cyp/<element-id>.wav` plus the `manifest.json` the player looks them up
in, keyed by the DOM ids the site generator emits. Re-synthesizes a paragraph
only when its text changes (sha1 in the manifest), unless `--force`.

Needs `variety_tts` + `onnxruntime`, which the site venv does not have:

    ~/projects/variety-tts/.venv/bin/python pyscripts/tts_audio/generate_cyp_audio.py
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import wave
from pathlib import Path

# Launched by path, so the site repo is not otherwise importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from pyscripts.tts_audio.cyp_paragraphs import (  # noqa: E402
    AUDIO_DIR,
    MANIFEST_PATH,
    collect_paragraphs,
    load_manifest,
    marker as untranslated_marker,
    text_hash,
)

# variety-tts synthesis stack (only available under the variety-tts venv).
from variety_tts.backends.piper import PiperVoice  # noqa: E402
from variety_tts.varieties import get_transcriber  # noqa: E402

LOGGER = logging.getLogger("generate_cyp_audio")

# CI has no ~/projects/variety-tts; it points VARIETY_TTS_MODEL at its download.
DEFAULT_MODEL = Path(
    os.environ.get("VARIETY_TTS_MODEL")
    or Path.home() / "projects" / "variety-tts" / "models" / "cypriot" / "cypriot.onnx"
).expanduser()
VARIETY = "el-cypriot"


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
        LOGGER.error("No model at %s — export one from the variety-tts repo, or set "
                     "VARIETY_TTS_MODEL to a downloaded copy.", args.model)
        return 2

    paragraphs = collect_paragraphs(untranslated_marker())
    if not paragraphs:
        LOGGER.info("No authored Cypriot paragraphs found — nothing to synthesize.")
        return 0

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    transcribe = get_transcriber(VARIETY).transcribe
    voice = PiperVoice(args.model)
    LOGGER.info("loaded %s (%d phonemes, %d Hz)", args.model.name, len(voice.id_map), voice.sample_rate)

    new_manifest: dict[str, dict] = {}
    synthesized = skipped = failed = 0

    for element_id, text in paragraphs.items():
        current_hash = text_hash(text)
        wav_path = AUDIO_DIR / f"{element_id}.wav"
        prev = manifest.get(element_id)
        if not args.force and prev and prev.get("hash") == current_hash and wav_path.exists():
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
            "hash": current_hash,
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
