"""Φέρνει το φόντο των εικόνων ταξινομικών ομάδων στο ίδιο μπεζ."""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

TARGET = np.array([228, 210, 176], dtype=np.float64)  # το μπεζ της πλειονότητας
BORDER = 8      # πλάτος πλαισίου από όπου εκτιμάται το χρώμα φόντου
NEAR = 20.0     # απόσταση RGB ως όπου το pixel θεωρείται καθαρό φόντο
FAR = 70.0      # απόσταση RGB πέρα από την οποία το pixel μένει ανέγγιχτο


def background_color(a):
    """Εκτιμά το χρώμα φόντου ως διάμεσο του πλαισίου της εικόνας."""
    ring = np.concatenate([
        a[:BORDER].reshape(-1, 3), a[-BORDER:].reshape(-1, 3),
        a[:, :BORDER].reshape(-1, 3), a[:, -BORDER:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0)


def retint(a, src):
    """Πολλαπλασιαστική διόρθωση src->TARGET, μόνο στα pixel που μοιάζουν με φόντο."""
    dist = np.linalg.norm(a - src, axis=2)
    weight = np.clip((FAR - dist) / (FAR - NEAR), 0.0, 1.0)[:, :, None]
    factor = TARGET / np.maximum(src, 1.0)
    return np.clip(a * (1.0 + weight * (factor - 1.0)), 0, 255)


def normalize(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float64)
    src = background_color(a)
    if np.array_equal(src, TARGET):
        return False
    Image.fromarray(retint(a, src).astype(np.uint8)).save(path)
    return True


def main(paths):
    for path in paths:
        print(("✔ " if normalize(path) else "· ") + str(path))


if __name__ == "__main__":
    args = sys.argv[1:]
    main([Path(p) for p in args] if args
         else sorted(Path("images/thumbnails").glob("*.png")))
