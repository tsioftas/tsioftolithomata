"""Build the unified list of translatable fields and write values back.

A *worklist item* is one translatable field somewhere in the data files. Every
supported language is exposed and editable (so you can fill in a new language *and*
fix typos in the existing ones), each with its own assignment path:

    {
      "id":        "taxonomy|animalia/subtaxa/chordata/name",
      "source":    "taxonomy",
      "group":     "Animalia › Chordata",   # human breadcrumb for grouping
      "field":     "name",                  # what the string is
      "multiline": false,
      "langs": {
        "el":  {"value": "...",  "path": ["animalia","subtaxa","chordata","name","el"]},
        "en":  {"value": "...",  "path": [...]},
        "grc": {"value": "...",  "path": [...]},
        "cyp": {"value": null,   "path": [...]},
      }
    }

Saving sends a `(source, path, value)` triple; `set_by_path` walks the path, creating
dict/list nodes as needed, so the tool is generic over every language.
"""

from pathlib import Path
from typing import Any, Dict, List

from .serializer import load_json, write_json

SITE_ROOT = Path(__file__).resolve().parent.parent.parent
JSONDATA = SITE_ROOT / "jsondata"

# source tag -> file path
SOURCES = {
    "dict": JSONDATA / "dict.json",
    "taxonomy": JSONDATA / "taxonomy.json",
    "geochronology": JSONDATA / "geochronology.json",
    "samples": JSONDATA / "samples_info.json",
}

LANGUAGES = load_json(JSONDATA / "languages.json")
ALL_LANGS = list(LANGUAGES.keys())

# Scalar fields (single string) and list fields (one string per paragraph/keyword).
_LOCALITY_SCALARS = ["name", "formation", "depositional_environment",
                     "fossil_types", "paleoecology_highlights"]
_LOCALITY_LISTS = ["description", "meta_keywords"]
_TAXON_SCALARS = ["name"]
_TAXON_LISTS = ["description", "etymology", "meta_keywords"]

_MULTILINE_HINT = 60  # a field is rendered tall if any language's value is longer
_WEIGHT_REF = ("el", "en", "grc")  # reference languages for sizing a field, in order


def _weight(langs) -> int:
    """Translation effort for a field, in words of the first available reference text.

    Used so progress reflects how much *text* is translated, not how many boxes are
    ticked — a 200-word description counts far more than a one-word label.
    """
    for l in _WEIGHT_REF:
        v = langs.get(l, {}).get("value")
        if v:
            return max(1, len(str(v).split()))
    return 1


def _mk_item(source, uid, group, field, langs):
    multiline = any(isinstance(v["value"], str) and len(v["value"]) > _MULTILINE_HINT
                    for v in langs.values())
    return {
        "id": source + "|" + uid,
        "source": source,
        "group": group,
        "field": field,
        "multiline": multiline,
        "weight": _weight(langs),
        "langs": langs,
    }


def _scalar_items(source, base_path, node, fields, group):
    """One item per scalar field present on `node` (value object keyed by language)."""
    items = []
    for field in fields:
        if field not in node:
            continue
        vd = node[field]
        langs = {l: {"value": vd.get(l), "path": base_path + [field, l]} for l in ALL_LANGS}
        items.append(_mk_item(source, "/".join(map(str, base_path + [field])), group, field, langs))
    return items


def _list_items(source, base_path, node, fields, group):
    """One item per element of each list field (description ¶, keyword, …)."""
    items = []
    for field in fields:
        if field not in node:
            continue
        vd = node[field]
        n = max((len(vd.get(l) or []) for l in ALL_LANGS), default=0) or 1
        is_para = field in ("description", "etymology")
        for i in range(n):
            label = f"{field} ¶{i + 1}" if is_para else f"{field} #{i + 1}"
            langs = {}
            for l in ALL_LANGS:
                seq = vd.get(l) or []
                langs[l] = {"value": seq[i] if i < len(seq) else None,
                            "path": base_path + [field, l, i]}
            items.append(_mk_item(source, "/".join(map(str, base_path + [field, i])), group, label, langs))
    return items


def _walk_taxon(taxon_id, node, base_path, breadcrumb):
    items = []
    en_name = str((node.get("name") or {}).get("en", taxon_id)).capitalize()
    group = " › ".join(breadcrumb + [en_name])
    items += _scalar_items("taxonomy", base_path, node, _TAXON_SCALARS, group)
    items += _list_items("taxonomy", base_path, node, _TAXON_LISTS, group)
    for sub_id, sub in (node.get("subtaxa") or {}).items():
        items += _walk_taxon(sub_id, sub, base_path + ["subtaxa", sub_id], breadcrumb + [en_name])
    return items


def build_worklist() -> List[Dict[str, Any]]:
    """Return every translatable field across the data files, all languages editable."""
    items: List[Dict[str, Any]] = []

    # 1. dict.json — flat UI labels: {lang: {key: value}}
    d = load_json(SOURCES["dict"])
    keys = list(d.get("el", {}))
    for key in keys:
        langs = {l: {"value": d.get(l, {}).get(key), "path": [l, key]} for l in ALL_LANGS}
        items.append(_mk_item("dict", key, "UI labels (dict.json)", key, langs))

    # 2. taxonomy.json — nested taxa
    for taxon_id, node in load_json(SOURCES["taxonomy"]).items():
        items += _walk_taxon(taxon_id, node, [taxon_id], [])

    # 3. geochronology.json — localities + countries
    geo = load_json(SOURCES["geochronology"])
    for lid, loc in geo.get("localities", {}).items():
        group = "Localities › " + str((loc.get("name") or {}).get("en", lid)).capitalize()
        bp = ["localities", lid]
        items += _scalar_items("geochronology", bp, loc, _LOCALITY_SCALARS, group)
        items += _list_items("geochronology", bp, loc, _LOCALITY_LISTS, group)
    for cc, country in geo.get("countries", {}).items():
        items += _scalar_items("geochronology", ["countries", cc], country, ["name"], "Countries")

    # 4. samples_info.json — image captions (incl. batch items)
    for sid, s in load_json(SOURCES["samples"]).items():
        loc = s.get("locality", "")
        group = f"Samples › {sid}" + (f" ({loc})" if loc else "")
        for i, img in enumerate(s.get("images", [])):
            if "caption" in img:
                base = [sid, "images", i, "caption"]
                langs = {l: {"value": img["caption"].get(l), "path": base + [l]} for l in ALL_LANGS}
                items.append(_mk_item("samples", "/".join(map(str, base)), group,
                                      f"caption {img.get('filename', '#' + str(i + 1))}", langs))
        for j, it in enumerate(s.get("items", [])):
            for k, img in enumerate(it.get("images", [])):
                if "caption" in img:
                    base = [sid, "items", j, "images", k, "caption"]
                    langs = {l: {"value": img["caption"].get(l), "path": base + [l]} for l in ALL_LANGS}
                    items.append(_mk_item("samples", "/".join(map(str, base)), group,
                                          f"caption {img.get('filename', f'{j + 1}.{k + 1}')}", langs))

    return items


def words_done(items, lang) -> int:
    """Sum of field weights (reference word counts) already translated into `lang`."""
    return sum(it["weight"] for it in items if it["langs"].get(lang, {}).get("value"))


def words_total(items) -> int:
    return sum(it["weight"] for it in items)


def _set_path(root: Any, segs: List[Any], value: str) -> None:
    node = root
    for i in range(len(segs) - 1):
        seg = segs[i]
        nxt = segs[i + 1]
        want_list = isinstance(nxt, int) or (isinstance(nxt, str) and nxt.isdigit())
        if isinstance(node, list):
            idx = int(seg)
            while len(node) <= idx:
                node.append(None)
            if node[idx] is None:
                node[idx] = [] if want_list else {}
            node = node[idx]
        else:
            if seg not in node or node[seg] is None:
                node[seg] = [] if want_list else {}
            node = node[seg]
    last = segs[-1]
    if isinstance(node, list):
        idx = int(last)
        while len(node) <= idx:
            node.append("")
        node[idx] = value
    else:
        node[last] = value


def set_by_path(source: str, path: List[Any], value: str) -> None:
    """Persist `value` at `path` inside the given source file (in its canonical style)."""
    if source not in SOURCES:
        raise ValueError(f"Unknown source: {source!r}")
    if not path:
        raise ValueError("Empty path")
    file = SOURCES[source]
    data = load_json(file)
    _set_path(data, list(path), value)
    write_json(file, data)
