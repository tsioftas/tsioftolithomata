"""Translation-entry tool.

A small local web app for adding translations of an existing language into a new
(or partial) language, one field at a time. It walks every translatable string in
the site's data files, shows the existing reference languages (el/en) beside each
one, lets you type the new-language value, and writes it back into the source JSON.

The tool is generic over the target language: ``--lang cyp`` today, any future code
tomorrow. The set of supported languages lives in ``jsondata/languages.json``.

Run it with::

    .venv/bin/python -m pyscripts.translate_tool --lang cyp
"""
