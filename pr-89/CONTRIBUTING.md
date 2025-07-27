# For a server running on WSL
run command in elevated Powershell before running server:
```powershell
netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=<WSL_IP>
```

# Adding new images
Before adding a new image, EXIF metadata should be removed.
```bash
mogrify -strip ./*/*/*.jpg
```

Remember to add the new image to the `samples` list in `scripts/random-sample.js` so that it can be randomly selected to be displayed in the home page.

# Adding new species
Use the `add_species.py` script to generate new pages for the new entry/ies. Keep in mind that the generated files will need careful editing before they are in workig order.

#### After adding new pages and/or changing the structure of the files under `tree/`, run `pyscripts/generate_pages_json.py` to re-generate `jsondata/pages.json`.
