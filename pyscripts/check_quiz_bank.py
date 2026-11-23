"""Check the quiz question bank under jsondata/quiz/.

Every taxon and every locality with specimens needs its own questions, and each
question needs text in every complete language. cyp may stay empty (shows its marker).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUIZ_DIR = ROOT / "jsondata/quiz"
MIN_QUESTIONS = {"taxa": 3, "localities": 2}
ANSWERS = 4


def required_entities() -> dict:
    taxonomy = json.loads((ROOT / "jsondata/taxonomy.json").read_text())
    samples = json.loads((ROOT / "jsondata/samples_info.json").read_text())
    taxa = []

    def walk(tree):
        for key, node in tree.items():
            taxa.append(key)
            walk(node.get("subtaxa") or {})

    walk(taxonomy)
    localities = {s["locality"] for s in samples.values() if not s["locality"].startswith("unknown")}
    return {"taxa": set(taxa), "localities": localities}


def check_text(where: str, text, languages: dict) -> list:
    if not isinstance(text, dict) or set(text) != set(languages):
        return [f"{where}: needs exactly the keys {sorted(languages)}"]
    return [f"{where}: empty {lang}" for lang, cfg in languages.items()
            if not cfg.get("partial") and not text[lang].strip()]


def check_file(path: Path, kind: str, languages: dict) -> list:
    where = path.relative_to(ROOT).as_posix()
    questions = json.loads(path.read_text())["questions"]
    errors = []
    if len(questions) < MIN_QUESTIONS[kind]:
        errors.append(f"{where}: {len(questions)} questions, needs at least {MIN_QUESTIONS[kind]}")
    for n, q in enumerate(questions):
        if set(q) != {"question", "answers", "explanation"}:
            errors.append(f"{where} #{n}: keys must be question, answers, explanation")
            continue
        errors += check_text(f"{where} #{n} question", q["question"], languages)
        errors += check_text(f"{where} #{n} explanation", q["explanation"], languages)
        if len(q["answers"]) != ANSWERS:
            errors.append(f"{where} #{n}: needs {ANSWERS} answers")
        for a, answer in enumerate(q["answers"]):
            errors += check_text(f"{where} #{n} answer {a}", answer, languages)
        for lang in languages:
            given = [a[lang] for a in q["answers"] if isinstance(a, dict) and a.get(lang)]
            if len(set(given)) != len(given):
                errors.append(f"{where} #{n}: repeated {lang} answers")
    return errors


def main():
    languages = json.loads((ROOT / "jsondata/languages.json").read_text())
    required = required_entities()
    errors = []
    for kind, keys in required.items():
        present = {p.stem for p in (QUIZ_DIR / kind).glob("*.json")}
        errors += [f"jsondata/quiz/{kind}/{k}.json: missing" for k in sorted(keys - present)]
        errors += [f"jsondata/quiz/{kind}/{k}.json: no such {kind[:-1]}" for k in sorted(present - keys)]
        for key in sorted(present & keys):
            errors += check_file(QUIZ_DIR / kind / f"{key}.json", kind, languages)
    for e in errors:
        print(e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
