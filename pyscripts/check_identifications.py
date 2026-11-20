"""Check specimen identification histories in jsondata/samples_info.json.

Every history must end on the specimen's lowest_taxa. Against a base ref, a new
specimen or a changed lowest_taxa must come with a new identification entry.
"""
import json
import subprocess
import sys
from pathlib import Path

import click

SAMPLES = "jsondata/samples_info.json"
LEVELS = "jsondata/identification_levels.json"
REQUIRED = ("taxon", "identifiedBy", "identificationVerificationStatus")


def _check_history(sample_id: str, info: dict, levels: dict) -> list:
    history = info.get("identifications")
    if history is None:
        return []
    if not history:
        return [f"{sample_id}: identifications is empty"]
    errors = []
    for n, entry in enumerate(history):
        for key in REQUIRED:
            if key not in entry:
                errors.append(f"{sample_id}: identification {n} lacks {key}")
        if str(entry.get("identificationVerificationStatus")) not in levels:
            errors.append(f"{sample_id}: identification {n} has an unknown level")
    if history[-1].get("taxon") != info.get("lowest_taxa"):
        errors.append(f"{sample_id}: last identification is not lowest_taxa")
    return errors


@click.command()
@click.option("--base", default=None, help="Git ref to compare against, e.g. origin/master.")
def main(base):
    root = Path(__file__).resolve().parent.parent
    samples = json.loads((root / SAMPLES).read_text())
    levels = json.loads((root / LEVELS).read_text())
    errors = []
    for sample_id, info in samples.items():
        errors += _check_history(sample_id, info, levels)

    if base:
        old = json.loads(subprocess.run(["git", "show", f"{base}:{SAMPLES}"], cwd=root,
                                        check=True, capture_output=True, text=True).stdout)
        for sample_id, info in samples.items():
            before = old.get(sample_id)
            if before is not None and before.get("lowest_taxa") == info.get("lowest_taxa"):
                continue
            old_count = len((before or {}).get("identifications") or [])
            if len(info.get("identifications") or []) <= old_count:
                what = "is new" if before is None else "changed lowest_taxa"
                errors.append(f"{sample_id}: {what} without a new identification entry")

    for error in errors:
        print(error, file=sys.stderr)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
