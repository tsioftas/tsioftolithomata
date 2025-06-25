import json
from pathlib import Path

SITE_ROOT = Path(__file__).parent.parent.parent
with open(SITE_ROOT / "jsondata/dict.json", "r") as f:
    GLOBAL_DICT = json.load(f)