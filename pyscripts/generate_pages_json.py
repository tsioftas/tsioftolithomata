from pathlib import Path
from typing import List
import json
import logging
import os

LOGGER = logging.getLogger(__name__)

def path_to_name(p: Path) -> str:
    name = p.name.rstrip(".html")
    if "_" in name:
        a, b = name.split("_")
        return f"{a.capitalize()} {b}"
    else:
        return name.capitalize()

def main():
    pages_json = Path(__file__).parent.parent / "jsondata/pages.json"
    server_root = Path(__file__).parent.parent

    paths: List[Path] = []

    queue: List[Path] = [server_root / "tree"]

    while queue:
        current = queue.pop()
        if current.is_dir():
            for child in current.iterdir():
                queue.append(child)
        elif str(current).endswith(".html"):
            paths.append(current)
        else:
            LOGGER.debug(f"Skipping {current.name}")

    pages = {
        "pages": [
            {
                "path": "/" + str(path.relative_to(server_root)),
                "name": path_to_name(path),
            }
            for path in paths
        ]
    }

    with open(pages_json, 'w') as f:
        json.dump(pages, f, indent=4)