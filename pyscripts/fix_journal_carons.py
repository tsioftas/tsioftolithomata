#!/usr/bin/env python3
"""Relocate misplaced Cypriot palatalization carons onto their σ/ζ.

In Cypriot orthography the combining caron (U+030C) marks a palatalized post-alveolar:
⟨σ̌⟩=[ʃ], ⟨ζ̌⟩=[ʒ], and in the affricate digraphs ⟨τσ̌⟩/⟨τζ̌⟩ it sits on the *second*
letter (the σ/ζ). The hand-typed Lyme Regis journal entry has the caron one base-letter
too early throughout — on the τ of ⟨τζ⟩ (τ̌ζ), on an accented vowel before σ (έ̌σει), on a
preceding κ/ι/α, etc. — so it renders on the wrong glyph and breaks the read-aloud text.

Fix: for every caron whose host base letter is **not** a σ/ζ, move it onto the next σ/ζ
base. If that σ/ζ already carries a caron, drop the duplicate (the one orphaned ``-̌σ̌``
case). Anything the rule cannot place is left untouched and reported for manual review.

Dry-run by default (prints a per-line diff + tally); pass --write to edit the file in place.

    python3 pyscripts/fix_journal_carons.py [path.md] [--write]
"""
from __future__ import annotations

import argparse
import sys
import unicodedata
from pathlib import Path

CARON = "̌"
TARGETS = set("σςζΣΖ")  # bases a Cypriot caron may attach to
DEFAULT_MD = Path(__file__).resolve().parent.parent / "journal/entries/lyme-regis-2026-CYP.md"


def _clusters(nfd: str) -> list[tuple[str, list[str]]]:
    """Group an NFD string into (base char, combining marks) clusters."""
    out: list[tuple[str, list[str]]] = []
    for ch in nfd:
        if unicodedata.combining(ch) and out:
            out[-1][1].append(ch)
        else:
            out.append((ch, []))
    return out


def relocate(text: str) -> tuple[str, dict[str, int], list[str]]:
    """Return (fixed_text, stats, warnings). Operates per line so a stray caron can never
    migrate across a line break into unrelated text.

    Rules (a caron only ever attaches to a σ/ζ):
      - caron already on a σ/ζ            -> keep.
      - caron on the base IMMEDIATELY      -> move it onto that σ/ζ (dedup if it already
        before a σ/ζ                          carries one — the orphaned ``-̌σ̌`` case).
      - caron on τ/Τ with no σ/ζ next      -> a dropped-σ affricate (⟨τ̌⟩ can only mean
                                              ⟨τσ̌⟩=[t͡ʃ]); rewrite as ⟨τσ̌⟩, inserting the σ.
      - anything else                      -> leave in place and warn for manual review.
    """
    stats = {"moved": 0, "dropped": 0, "inserted": 0}
    warnings: list[str] = []
    fixed_lines: list[str] = []

    for lineno, line in enumerate(text.splitlines(keepends=True), 1):
        nl = line[len(line.rstrip("\n")):]  # preserved trailing newline
        clusters = _clusters(unicodedata.normalize("NFD", line.rstrip("\n")))
        n = len(clusters)
        pending = False  # a caron relocating onto the very next cluster (a verified σ/ζ)
        result: list[str] = []
        for i, (base, marks) in enumerate(clusters):
            has_caron = CARON in marks
            other = [m for m in marks if m != CARON]
            if base in TARGETS:
                carry = has_caron or pending
                if has_caron and pending:
                    stats["dropped"] += 1  # σ/ζ already caroned -> drop the duplicate
                if pending:
                    stats["moved"] += 1
                pending = False
                result.append(base + (CARON if carry else "") + "".join(other))
                continue
            # non-target base
            result.append(base + "".join(other))
            if not has_caron:
                continue
            nxt = clusters[i + 1][0] if i + 1 < n else None
            if nxt in TARGETS:
                pending = True  # relocate onto the immediate σ/ζ next step
            elif base in ("τ", "Τ"):
                result.append("σ" + CARON)  # ⟨τ̌⟩ with no σ -> the affricate ⟨τσ̌⟩
                stats["inserted"] += 1
            else:
                result[-1] = base + CARON + "".join(other)  # can't place it — keep + warn
                warnings.append(f"line {lineno}: caron on {base!r} has no σ/ζ to attach to — left in place")
        fixed_lines.append(unicodedata.normalize("NFC", "".join(result)) + nl)

    return "".join(fixed_lines), stats, warnings


def _audit(text: str) -> dict[str, int]:
    """Count which base letter each caron currently attaches to (for before/after report)."""
    counts: dict[str, int] = {}
    for base, marks in _clusters(unicodedata.normalize("NFD", text)):
        if CARON in marks:
            counts[base] = counts.get(base, 0) + 1
    return counts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", nargs="?", type=Path, default=DEFAULT_MD, help="markdown entry to fix")
    ap.add_argument("--write", action="store_true", help="edit the file in place (default: dry run)")
    args = ap.parse_args()

    src = args.path.read_text(encoding="utf-8")
    fixed, stats, warnings = relocate(src)

    print(f"caron hosts BEFORE: {_audit(src)}")
    print(f"caron hosts AFTER : {_audit(fixed)}")
    print(f"moved={stats['moved']} dropped_duplicates={stats['dropped']} "
          f"inserted_σ={stats['inserted']} warnings={len(warnings)}")
    for w in warnings:
        print(f"  ! {w}")

    if args.write:
        if fixed != src:
            args.path.write_text(fixed, encoding="utf-8")
            print(f"wrote {args.path}")
        else:
            print("no change")
    else:
        print("(dry run — pass --write to apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
