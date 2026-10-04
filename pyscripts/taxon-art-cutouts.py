"""Cut-out copies of the taxon illustrations, their beige ground made transparent.

The illustrations are painted on #E5D2B1. The pages set them on a plate of their own
colour (var(--art-plate)): that beige in the light theme, a dark one in the dark, so
the ground has to come out of the image. Writes images/thumbnails/cutout/<name>.webp
and <name>_thumb.webp; the originals are left as they are.

usage: .venv/bin/python pyscripts/taxon-art-cutouts.py [name.jpg ...]   (default: all)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path("images/thumbnails")
OUT = SRC / "cutout"
GROUND = np.array([229, 210, 177], float)   # #E5D2B1
LO, HI = 12, 42      # colour distance: fully ground below LO, fully art above HI
FULL, THUMB = 800, 300
QUALITY = 82


def cut_out(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im, float)
    dist = np.sqrt(((rgb - GROUND) ** 2).sum(-1))
    # Only ground reachable from the edge goes: beige inside a shell or a bone stays.
    near = Image.fromarray(np.where(dist < HI, 255, 0).astype("uint8"))
    framed = Image.new("L", (im.width + 2, im.height + 2), 255)
    framed.paste(near, (1, 1))
    ImageDraw.floodfill(framed, (0, 0), 128)
    ground = np.asarray(framed)[1:-1, 1:-1] == 128
    alpha = np.ones(dist.shape)
    alpha[ground] = np.clip((dist[ground] - LO) / (HI - LO), 0, 1)
    # Paper grain leaves specks in the matte; a median pass takes them out.
    matte = Image.fromarray((alpha * 255).astype("uint8")).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(0.7))
    a = np.asarray(matte, float)[..., None] / 255
    # The beige taken out of the half-transparent edge too, so a painted shadow is a
    # dark veil on any plate rather than a beige halo.
    clean = np.where(a > 0.02, (rgb - (1 - a) * GROUND) / np.maximum(a, 0.02), rgb)
    out = Image.fromarray(np.clip(clean, 0, 255).astype("uint8"))
    out.putalpha(matte)
    return out


def main(names):
    OUT.mkdir(exist_ok=True)
    for path in names:
        out = cut_out(path)
        full = out.copy()
        full.thumbnail((FULL, FULL))
        full.save(OUT / f"{path.stem}.webp", "WEBP", quality=QUALITY, method=6)
        out.thumbnail((THUMB, THUMB * 2))
        out.save(OUT / f"{path.stem}_thumb.webp", "WEBP", quality=QUALITY, method=6)
        print(f"✔ {path.stem}")


if __name__ == "__main__":
    args = [SRC / a for a in sys.argv[1:]] or sorted(SRC.glob("*.jpg"))
    main(args)
