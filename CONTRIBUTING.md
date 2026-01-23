# Contributing to Tsioftolithomata

Welcome! This guide will help you set up the project, run it locally, and add your own content (taxa, samples, and journal entries).

## Prerequisites

- Python 3.x and dependencies

## Setup

### 1. Clone the Repository

### 2. Create a Python Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install -r pyscripts/requirements.txt
```

## Running the Server

Once your virtual environment is set up and dependencies are installed:

```bash
# Make sure you're in the project root directory
python3 server.py
```

The website will be available at `http://localhost:8000`

**Note for WSL Users:** If running on Windows Subsystem for Linux, you might need to enable port forwarding in an elevated PowerShell window:
```powershell
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=<WSL_IP>
```

## Adding New Content

All journal, taxonomy and locality .html (and accompanying .json) pages in this repo are auto-generated based on data living in `jsondata/samples_info.json`, `jsondata/geochronology.json` and `jsondata/taxonomy.json`.

To generate these files, run
```bash
python3 -m pyscripts.site_genrator.generate_site
```

### Adding taxa

1. **Update the taxonomy** in `jsondata/taxonomy.json` to include your new taxon with its metadata

1. **Add a thumbnail for your taxon** in images/
    
1. **Generate all image thumbnails**
- Edit `pyscripts/images-thumbs.py` to include your image files.
- Run it to generate `.webp` and thumbnail versions:
```python
python3 pyscripts/images-thumbs.py
```

4. **Remove image EXIF metadata** by running 
```bash
exiftool -r all= -overwrite_original images/<your directory or file>
```

5. **Update the dictionary**

Update `jsondata/dict.json` with translations for your new taxon.

### Adding fossils

1. **Add photos of the specimen** in the images/ directory

1. **Generate image thumbnails:**
   - Edit `pyscripts/images-thumbs.py` to include your image directories
   - Run it to generate `.webp` and thumbnail versions:
     ```bash
     python3 pyscripts/images-thumbs.py
     ```

3. **Remove image EXIF metadata** by running 
```bash
exiftool -r all= -overwrite_original images/<your thumbnail dir>
```

4. **Add sample information** to `jsondata/samples_info.json`

### Adding localities

1. **Add locality information** to `jsondata/geochronology.json`

2. **Add photos of the specimen** in the images/ directory

3. **Generate image thumbnails:**
   - Edit `pyscripts/images-thumbs.py` to include your image(s)
   - Run it to generate `.webp` and thumbnail versions:
     ```bash
     python3 pyscripts/images-thumbs.py
     ```

4. **Remove image EXIF metadata** by running 
```bash
exiftool -r all= -overwrite_original images/<your image(s)>
```

### Adding Journal Entries

Journal entries document research, experiments, and conservation work.

1. **Create a markdown file** in `journal/entries/` with multilingual support:
   - Use suffixes: `-EL` (Greek), `-EN` (English), `-GRC` (Ancient Greek)
   - Example: `my_entry-EN.md`, `my_entry-EL.md`
   - Use standard markdown format with a YAML front matter header containing:
     - `title`: Entry title
     - `date`: Entry date
     - Any other relevant metadata

2. **Add accompanying media** to `journal/media/` if needed (images, scans, etc.)

Remember to:
- **Generate image thumbnails:**
   - Edit `pyscripts/images-thumbs.py` to include your images
   - Run it to generate `.webp` and thumbnail versions:
     ```bash
     python3 pyscripts/images-thumbs.py
     ```

- **Remove image EXIF metadata** by running 
```bash
exiftool -r all= -overwrite_original journal/media/<your images>
```

## Auto-generating Content

As stated above, to regenerate all auto-generated content (taxa pages, journal, localities, etc.), run:

```bash
python3 -m pyscripts.site_generator.generate_site
```

This will:
- Generate all files in `localities/`
- Generate all files in `tree/` (taxonomic pages)
- Generate .html files in `journal/`
- Generate `unclassified.html` and `unclassified.json`
- Regenerate `jsondata/pages.json`
- Regenerate `scripts/random-sample.js`
- Generate `map.html` and `map.json`
- Generate `index.html` and `index.json`

## File Structure Overview

See [README.md](README.md) for detailed documentation of all files and directories.

## Tips

- Always remove image metadata before uploading files online
- Always regenerate auto-generated files after making structural changes
- Test the site locally with `python3 server.py` before committing
- Use meaningful commit messages that explain what content was added
