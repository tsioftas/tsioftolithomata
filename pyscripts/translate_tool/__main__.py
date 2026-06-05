"""CLI entry point: ``python -m pyscripts.translate_tool --lang cyp``."""

import click

from .serializer import load_json
from .server import serve
from .worklist import SITE_ROOT


@click.command()
@click.option("--lang", "target_lang", default="cyp", show_default=True,
              help="Language whose completion is tracked in the progress bar. "
                   "Every language is editable regardless (see jsondata/languages.json).")
@click.option("--port", default=8765, show_default=True, help="Port for the editor.")
def main(target_lang, port):
    languages = load_json(SITE_ROOT / "jsondata" / "languages.json")
    if target_lang not in languages:
        raise click.BadParameter(
            f"{target_lang!r} is not in jsondata/languages.json "
            f"(known: {', '.join(languages)})", param_hint="--lang")
    serve(target_lang, port)


if __name__ == "__main__":
    main()
