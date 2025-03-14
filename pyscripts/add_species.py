from pathlib import Path
import jinja2
import enum

class Language(enum.Enum):
    ENGLISH = 0
    GREEK = 1

    def en_to_el(word):
        return {
            "Kingdom": "Βασίλειο",
            "Phylum": "Συνομοταξία",
            "Class": "Ομοταξία",
            "Subclass": "Υφομοταξία",
            "Family": "Οικογένεια",
            "Genus": "Γένος",
            "Species": "Είδος",
        }[word]

levels = [
        "Kingdom",
        "Phylum",
        "Class",
        "Subclass",
        "Family",
        "Genus",
        "Species"
    ]

def write_species_files(species_dir, new_entry):
    template_html = jinja2.Template((Path(__file__).parent.parent / "templates/species.html.template").read_text())
    template_json = jinja2.Template((Path(__file__).parent.parent / "templates/species.json.template").read_text())

    species_html = template_html.render(
        name=new_entry["Species"][Language.ENGLISH],
        name_dir=species_dir,
    )
    html_file = species_dir / f"{new_entry["Species"][Language.ENGLISH]}.html"
    html_file.write_text(species_html)
    species_json = template_json.render(
        name=new_entry["Genus"][Language.ENGLISH]+"_"+new_entry["Species"][Language.ENGLISH],
        kingdom_el=new_entry["Kingdom"][Language.GREEK],
        kingdom_en=new_entry["Kingdom"][Language.ENGLISH],
        phylum_el=new_entry["Phylum"][Language.GREEK],
        phylum_en=new_entry["Phylum"][Language.ENGLISH],
        class_el=new_entry["Class"][Language.GREEK],
        class_en=new_entry["Class"][Language.ENGLISH],
        subclass_el=new_entry["Subclass"][Language.GREEK],
        subclass_en=new_entry["Subclass"][Language.ENGLISH],
        family_el=new_entry["Family"][Language.GREEK],
        family_en=new_entry["Family"][Language.ENGLISH],
        genus_el=new_entry["Genus"][Language.GREEK],
        genus=new_entry["Genus"][Language.ENGLISH],
        species=new_entry["Species"][Language.ENGLISH],
    )
    json_file = species_dir / f"{new_entry["Species"][Language.ENGLISH]}.json"
    json_file.write_text(species_json)
    

def write_tax_files(tax_dir, tax, new_entry):
    template_html = jinja2.Template((Path(__file__).parent.parent / "templates/tax.html.template").read_text())
    template_json = jinja2.Template((Path(__file__).parent.parent / "templates/tax.json.template").read_text())

    tax_html = template_html.render(
        name_en=new_entry[tax][Language.ENGLISH],
        name_el=new_entry[tax][Language.GREEK],
        subitems=[],
        name_en_dir=tax_dir,

    )
    html_file = tax_dir / f"{new_entry[tax][Language.ENGLISH]}.html"
    html_file.write_text(tax_html)
    tax_json = template_json.render(
        name_en=new_entry[tax][Language.ENGLISH],
        name_el=new_entry[tax][Language.GREEK],
        tax_el=Language.en_to_el(tax),
        tax_en=tax,
        subitems=[],
    )
    json_file = tax_dir / f"{new_entry[tax][Language.ENGLISH]}.json"
    json_file.write_text(tax_json)





if __name__ == "__main__":
    cwd = Path(__file__).parent.parent / "tree"
    new_entry = {}
    for level in levels:
        print(level)
        subdirs = sorted(cwd.glob("*/"))
        print("0. Create new")
        print("\n".join([f"{i+1}. {x.name}" for i, x in enumerate(subdirs)]))
        choice = None
        while choice is None:
            try:
                choice = int(input())
                if choice == 0:
                    name = input("Enter name (en,el): ")
                    name = {Language.ENGLISH: name.split(",")[0], Language.GREEK: name.split(",")[1]}
                    print(
                        "Please confirm:"
                        f"en: {name[Language.ENGLISH]}, el: {name[Language.GREEK]}"
                    )
                    confirm = input("y/n")
                    if confirm != "y":
                        choice = None
                        continue
                    new_dir = cwd / name[Language.ENGLISH]
                    new_dir.mkdir()
                    new_entry[level] = name
                    relative_new_dir = Path("/tree" + str(new_dir).split("geministoselis/tree", 1)[1])

                    if level == "Species":
                        write_species_files(relative_new_dir, new_entry)
                    else:
                        write_tax_files(relative_new_dir, level, new_entry)
                    cwd = new_dir
                else:
                    new_entry[level] = {
                        Language.ENGLISH: subdirs[choice-1].name,
                        Language.GREEK: subdirs[choice-1].name, # TODO: Add Greek names 
                    }
                    cwd = subdirs[choice-1]
            except (ValueError, IndexError):
                print("Invalid choice")
                choice = None
    print(new_entry)

new_entry = {
    "Kingdom": {
    Language.ENGLISH: "animalia",
    Language.GREEK: "ζώα",
    },
    "Phylum": {
    Language.ENGLISH: "chordata",
    Language.GREEK: "χορδωτά",
    },
    "Class": {
    Language.ENGLISH: "chondrichthyes",
    Language.GREEK: "χονδριχθύες",
    },
    "Subclass": {
    Language.ENGLISH: "elasmobranchii",
    Language.GREEK: "ελασμοβράγχιοι",
    },
    "Family": {
    Language.ENGLISH: "dasyatidae",
    Language.GREEK: "δασυατίδες",
    },
    "Genus": {
    Language.ENGLISH: "hypolophodon",
    Language.GREEK: "υπολοφόδων",
    },
    "Species": {
    Language.ENGLISH: "sylvestris",
    Language.GREEK: "sylvestris"
    }
}