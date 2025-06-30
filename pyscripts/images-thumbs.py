from PIL import Image
import os

# === Ρυθμίσεις ===
ROOT_DIRS = []  # Ρύθμισε το path όπως χρειάζεται
LARGE_WEBP = True               # Κατά πόσον θα δημιουργηθούν μεγάλες εικόνες webp
THUMBS_DIRNAME = "thumbs_dir"       # Όνομα υποφακέλων εικονιδίων
if LARGE_WEBP:
    WEBP_DIRNAME = "webp_dir"           # Όνομα υποφακέλων .webp
QUALITY = 85                       # Ποιότητα JPG/WEBP
THUMB_WIDTH = 300                 # Πλάτος μικρογραφίας
assert False, "This script can make big changes. Please carefully review these values"

def convert_and_save(img_path, output_path, fmt, quality=85):
    img = Image.open(img_path).convert("RGB")  # PNG μπορεί να έχει transparency
    img.save(output_path, format=fmt, quality=quality, optimize=True)
    print(f"✔ Saved: {output_path}")

def make_thumbnail(img_path, thumb_jpg_path, thumb_webp_path):
    img = Image.open(img_path).convert("RGB")
    img.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 2))
    img.save(thumb_jpg_path, format="JPEG", quality=QUALITY)
    img.save(thumb_webp_path, format="WEBP", quality=QUALITY)
    print(f"🖼 Thumbnail: {thumb_jpg_path} + {thumb_webp_path}")

for root_dir in ROOT_DIRS:
    for root, _, files in os.walk(root_dir):
        if root.endswith(WEBP_DIRNAME) or root.endswith(THUMBS_DIRNAME):
            continue

        for file in files:
            full_path = os.path.join(root, file)
            name, ext = os.path.splitext(file)
            ext = ext.lower()

            if ext in [".png", ".jpg", ".jpeg"]:
                thumb_dir = os.path.join(root, THUMBS_DIRNAME)
                if LARGE_WEBP:
                    webp_dir = os.path.join(root, WEBP_DIRNAME)
                os.makedirs(thumb_dir, exist_ok=True)
                if LARGE_WEBP:
                    os.makedirs(webp_dir, exist_ok=True)
                jpg_path = os.path.join(root, f"{name}.jpg")
                if LARGE_WEBP:
                    webp_path = os.path.join(webp_dir, f"{name}.webp")
                thumb_jpg = os.path.join(thumb_dir, f"{name}_thumb.jpg")
                thumb_webp = os.path.join(thumb_dir, f"{name}_thumb.webp")

                # overwrite jpeg image if it exists
                convert_and_save(full_path, jpg_path, "JPEG", quality=QUALITY)
                if LARGE_WEBP:
                    convert_and_save(full_path, webp_path, "WEBP", quality=QUALITY)
                make_thumbnail(full_path, thumb_jpg, thumb_webp)
