"""JSON (de)serialization that preserves the data files' hand-maintained style.

The site's data files (taxonomy.json, geochronology.json, ...) are formatted with a
specific convention: 4-space indentation, with short scalar arrays kept on a single
line (e.g. meta_keywords) but arrays containing long strings (descriptions,
etymologies) expanded one element per line. A plain ``json.dump(indent=4)`` would
expand every array and churn ~100KB of whitespace in taxonomy.json.

``dumps`` reproduces that convention so the tool's writes are minimal diffs: it keeps
a scalar array inline unless any element is a string longer than ``INLINE_MAX``.
``taxonomy.json`` round-trips exactly under this rule; the other files differ only in
a handful of pre-existing inconsistencies that normalize harmlessly on first write.
"""

import json
from pathlib import Path
from typing import Any

INLINE_MAX = 60  # a scalar array stays inline unless an element string exceeds this


def dumps(obj: Any, indent: int = 4, _level: int = 0) -> str:
    pad = " " * (indent * _level)
    pad1 = " " * (indent * (_level + 1))
    if isinstance(obj, dict):
        if not obj:
            return "{}"
        items = [
            f"{pad1}{json.dumps(k, ensure_ascii=False)}: {dumps(v, indent, _level + 1)}"
            for k, v in obj.items()
        ]
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(obj, list):
        if not obj:
            return "[]"
        scalars = all(isinstance(e, (str, int, float, bool)) or e is None for e in obj)
        longish = any(isinstance(e, str) and len(e) > INLINE_MAX for e in obj)
        if scalars and not longish:
            return "[" + ", ".join(json.dumps(e, ensure_ascii=False) for e in obj) + "]"
        items = [f"{pad1}{dumps(e, indent, _level + 1)}" for e in obj]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    return json.dumps(obj, ensure_ascii=False)


def load_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: Any) -> None:
    """Write `obj` to `path` in the repository's canonical style (trailing newline)."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(dumps(obj) + "\n")
