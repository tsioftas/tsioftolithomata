import os
import json
from datetime import datetime

# === CONFIG ===
BASE_URL = "https://tsioftas.github.io/tsioftolithomata"
SITE_ROOT = "." # Assuming the script is run from the root of the site

with open("jsondata/geochronology.json", "r", encoding="utf-8") as f:
        localities = json.load(f)["localities"]
with open("jsondata/samples_info.json", "r", encoding="utf-8") as f:
        samples_info = json.load(f)
max_locality_samples = max(len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["locality"] == loc]) for loc in localities.keys())
max_taxon_samples = max(len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["lowest_taxa"] == tax or (isinstance(sample_info["lowest_taxa"], list) and tax in sample_info["lowest_taxa"])]) for tax in set(sample_info["lowest_taxa"] for sample_id, sample_info in samples_info.items() if isinstance(sample_info["lowest_taxa"], str)))

def get_locality_priority(locality: str) -> str:
    """
    Custom priority logic for localities.
    priority = 0.1 + 0.7 * (locality_samples / max_locality_samples)
    """
    locality_samples = len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["locality"] == locality])
    return f"{0.1 + 0.7 * (locality_samples / max_locality_samples):.1f}"

def get_taxonomy_priority(taxon: str) -> str:
    """
    Custom priority logic for taxonomy.
    priority = 0.1 + 0.6 * (taxon_samples / max_taxon_samples)
    """
    taxon_samples = len([sample_id for sample_id, sample_info in samples_info.items() if sample_info["lowest_taxa"] == taxon or (isinstance(sample_info["lowest_taxa"], list) and taxon in sample_info["lowest_taxa"])])
    return f"{0.1 + 0.6 * (taxon_samples / max_taxon_samples):.1f}"

def get_priority(filepath: str) -> str:
    """
    Stub for custom priority logic.
    You can base it on path depth, folder name, file name, etc.
    """
    if filepath == "index.html":
        return "1.0"
    elif filepath.startswith("localities/"):
        return get_locality_priority(filepath.split("/")[1])
    elif filepath.startswith("tree/"):
        return get_taxonomy_priority((filepath.split("/")[-1]).split(".")[0])
    elif filepath == "unclassified.html":
        return "0.5"
    elif filepath == "map.html":
        return "0.7"
    else:
        print(f"Warning: No custom priority for {filepath}, using default.")
        return "0.5"

if __name__ == "__main__":
    sitemap_entries = []
    for root, dirs, files in os.walk(SITE_ROOT):
        if root != "." and not any(root.startswith(allowed_path) for allowed_path in ["./localities", "./tree"]):
            continue
        for file in files:
            if file.endswith(".html"):
                path = os.path.join(root, file)
                rel_path = os.path.relpath(path, SITE_ROOT).replace("\\", "/")

                # Ignore sitemap.xml itself if it's in the tree
                if rel_path == "sitemap.xml":
                    continue

                url = f"{BASE_URL}/{rel_path}"
                lastmod_time = os.path.getmtime(path)
                lastmod = datetime.fromtimestamp(lastmod_time).strftime('%Y-%m-%d')
                priority = get_priority(rel_path)

                entry = f"""  <url>
        <loc>{url}</loc>
        <lastmod>{lastmod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>{priority}</priority>
    </url>"""
                sitemap_entries.append(entry)

    # Final sitemap XML
    sitemap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    {chr(10).join(sitemap_entries)}
    </urlset>
    """

    # Write to file
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(sitemap_xml)

    print(f"✅ sitemap.xml generated with {len(sitemap_entries)} entries.")
