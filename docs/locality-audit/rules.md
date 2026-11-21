# Locality audit rules

These rules apply to the auditor and the reviewer (Codex) alike. Scope: one locality entry in `jsondata/geochronology.json` plus its image `images/localities/thumbnails/<key>.{png,jpg}`. Leave samples, taxa and other localities alone.

## Sources
- Never state a fact from memory. Every claim needs a named source, quoted in the PR description.
- Give each claim its own source where possible. Don't cite one paper for everything.
- The cited source must cover THIS locality, not only the formation in general. Check it.
- Credible sources: national geological surveys (BGS Lexicon `webapps.bgs.ac.uk/lexicon/lexicon.cfm?pub=CODE`, GSD Cyprus, etc.), GCR volumes (`data.jncc.gov.uk` PDFs), peer-reviewed papers, university or museum pages, GiGL for London. Use enthusiast sites such as UKFossils only for observations about the site itself (what crops out on the beach, etc.).
- Member entries in the BGS Lexicon are often more specific than formation entries.
- Cite PDFs with `#page=N`, where N is the PDF page index, not the printed page number. Cite HTML pages with a text fragment `#:~:text=...` that really occurs on the page.
- Explain every technical term, with a source (e.g. "type section, the place where a unit is formally defined").
- Don't be more specific than the source: write "dinosaurs", not "a dinosaur", when the source says "dinosaur remains".

## Content
- Focus on the palaeoenvironment: what the place was like then. No fossil-hunting tips and no safety paragraphs.
- Style: narrative and sensory, not a journal article ("the map shows…" is out). No em-dashes. Plain words.
- `meta_keywords` must use the same forms as the `name` field. Add 3-5 broader phrases (palaeontology, fossil hunting, …). el/grc keywords contain no Latin script.
- `paleoecology_highlights` describes ecology (who lived how, where, and what happened), not a list of fossils.
- `fossil_types` lists only groups that have a source for this locality.
- `age`: use the stage boundaries given by a cited source.
- Never touch `coords_lat` or `coords_lon`. Never put coordinates in commits, PRs or URLs.
- cyp: leave the fields empty (`""` or `[]`). Add them if they are missing. Never write Cypriot text.
- The generator never punctuates data. Don't end fields with a full stop unless the field is prose.

## el (Modern Greek, monotonic)
- No English or Latin anywhere: no binomials, no jargon ("index fossil" becomes «απολίθωμα-δείκτης»). Binomials go only in en.
- Use the Greek forms of names: «Όουεν», «Γουλιέλμος», «Λινναίος».
- Keep established place-name spellings even when the pronunciation differs: «Χάργουιτς», «Μπλακ Βεν», «Στόουνμπαροου», «Τσάρμουθ», «Γκόλντεν Καπ».
- Established names: «Μάργα των Βελεμνιτών», «Μάργα του Μπλακ Βεν», «Σχιστόλιθοι με Βοδινό», «Πηλόλιθος των Πράσινων Αμμωνιτών», «Άργιλος του Ιπ», «Πλιενσβάχιο», βραχιόποδα (not βραχιονόποδα), θαλάσσια κρίνα (neuter).
- Prefer «περιστασιακά» to «κάπου κάπου». For fast sedimentation, write «ταχεία απόθεση».
- Citation labels: «κ.ά.» and «&». The Greek name of the institution: «Βρετανική Γεωλογική Υπηρεσία», «Πανεπιστήμιο του Μπρίστολ».
- `·` in el text is U+0387. In Edit `old_string`, write it as `·`.

## grc (Ancient Greek, polytonic)
- Check every word in LSJ: `python3 ~/projects/lsj-tools/bin/lsj.py <greek words>`. Input is Greek; diacritics are ignored.
- BUT established site vocabulary takes precedence. Before replacing a word that LSJ lacks, grep jsondata: στρῶμα, εὑρήματα, τροπικός, πυριτολιθικός, παλιρροιακὰ κανάλια, ὑφάλμυρος, παγετώδης ἀπόθεσις, τύρφη, ἀσβεστίτης, ἀσβεστώδης, ἵζημα, ὀξυγόνον, μάργα, Πλιενσβάχιον, θηρευτής, ἐχῖνος, τευθίς.
- Place names: translate by meaning, the way Strabo would, when the meaning is SOURCED: Golden Cap = «Χρυσοῦς Πῖλος», Black Ven = «Μέλαν Ἕλος», Eype Mouth = «Στόμα τοῦ Ἴπ», cf. «Γιλβέρτειον δέλτα». Otherwise transliterate: «Στόουνβαρρου», «Ἴπ», «Δίραμ», «Σητάνη».
- Cities: Manchester = «Μαγχεστέρη», Bristol = «Βρίστολον».
- Grammar: a neuter plural subject takes a singular verb. Use μέν…δέ only for a real contrast. For "shallow" write ἀβαθής.
- LSJ traps: avoid ἀνῄει. θερμοκρασία means "mixing a hot drink". κοινότης is about people. ἄνοδος is not uplift. Write «Τοῦτο δὲ σημεῖόν ἐστι + gen.», not «, σημεῖον ὅτι».
- No Modern Greek calques as glosses.
- Years in Greek numerals: `greek_numeral(n)` from `pyscripts/site_generator` (2001 → ͵βαʹ, 2004 → ͵βδʹ).
- Citation labels: «καὶ ἄλλοι» and «καί» + Greek-numeral year, e.g. «Simms ͵βδʹ», «Benton καὶ Spencer ͵αϡϟεʹ». Institutions: «Βρεταννικὴ Γεωλογικὴ Ὑπηρεσία».
- `·` in grc text is U+00B7.

## Images
- Check the reconstruction against the sources. Replace it only if it shows something wrong.
- A new image shows NO fauna (no animals at all). Landscape or seabed only.
- Style: matte, muted, a 19th-century oil painting. Not glossy and not AI-looking.
- Generate it with: `codex exec --skip-git-repo-check -s workspace-write -C <scratch dir> -i <old image> -i images/localities/thumbnails/mari.jpg - < prompt.txt`. The prompt goes on stdin, because `-i` swallows positional args. Take the style references from `git show HEAD:<path>`.
- Then save it as `images/localities/thumbnails/<key>.png` and run `.venv/bin/python pyscripts/images-thumbs.py --files images/localities/thumbnails/<key>.png`.

## Editing
- Edit sequentially with the Edit tool. No sed, Python or awk on content.
- Many localities share text. Anchor every Edit on a line that occurs only in this entry.
- Before committing, run `git diff -U0`. Every hunk must fall inside this locality's line range.
- Build check: `.venv/bin/python -m pyscripts.site_generator.generate_site`. Its output is gitignored. If generated files that are tracked appear in `git status`, discard them with `git checkout`.
- Commit messages and PR descriptions are sober and technical.
