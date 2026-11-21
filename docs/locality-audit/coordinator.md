# Overnight locality-audit coordinator

You are the coordinator. You don't audit anything yourself. You launch one subagent per locality, sequentially, and merge their PRs. Everything runs unattended: never ask the user anything. Questions go into the PRs.

Repo: `/home/tsioftas/projects/tsioftolithomata` (GitHub `tsioftas/tsioftolithomata`).
Rules: `docs/locality-audit/rules.md`. Reviewer prompt: `docs/locality-audit/codex-review.md`.

## Setup (already done, verify it)
- Branch `bot/overnight-work` exists on origin, with a draft master PR into `master`. Find it with `gh pr list --head bot/overnight-work`.
- LSJ helper: `python3 ~/projects/lsj-tools/bin/lsj.py ἕλος` must print a gloss.

## Queue (geochronology.json order)
fort-victoria, compton-bay, ulrome, robin-hoods-bay, lyme_regis, bracklesham_bay, kem-kem, mimarighen, alnif_ktaoua, taallalt, ighas_mountain, north-esk, dnipro-kamianske

Skip: everything before seatown (already audited), kokkinochoria_*, unknown-cyprus.
Before you start, re-list the keys with `grep -nE '^        "[a-z_-]+": \{' jsondata/geochronology.json`. Some keys contain hyphens. Add any locality that is missing from the queue to the end.

## Loop, one locality at a time
1. `git checkout bot/overnight-work && git pull`.
2. Launch ONE `general-purpose` subagent in the foreground with the prompt below, with `{KEY}` filled in. Wait for it to finish.
3. Read its final report. You need the PR number and the status.
4. Verify for yourself: the PR's last Codex comment ends with `VERDICT: APPROVED`, and `gh pr diff` touches only that locality and its image.
   - If both hold: `gh pr merge <n> --squash --delete-branch`.
   - If not: add the label `needs-human` (`gh pr edit <n> --add-label needs-human`; create the label once if it is missing) and leave the PR open.
5. Update the master PR description. Keep a table with locality, PR, status (merged / needs-human), and open questions, linked to the PR.
6. On to the next locality. A failure in one locality never stops the queue.

When the queue is finished, the master PR stays a draft. The user reviews it in the morning.

## Subagent prompt

```
Audit the locality page "{KEY}" of the fossil site in /home/tsioftas/projects/tsioftolithomata.
You run unattended. Never ask the user anything. Undecided things go into "Open questions" in the PR description.

Read docs/locality-audit/rules.md and follow it exactly.

1. Setup: git checkout bot/overnight-work && git pull && git checkout -b bot/audit-{KEY}.
   Put temporary files in /tmp/claude-1000/locality-audit/{KEY}/ (a fresh dir for downloads; run Python on them with -I).
2. Read the "{KEY}" entry in jsondata/geochronology.json, the specimens (grep '"locality": "{KEY}"' in jsondata/samples_info.json; field.json is one line: grep -o '[^{]*"l":"{KEY}"[^}]*' jsondata/field.json), and the image images/localities/thumbnails/{KEY}.jpg.
3. Check every claim against credible sources. Find which formations/members actually crop out HERE. Rewrite en, then el, then grc (LSJ-check every grc word, but established vocabulary takes precedence). Add empty cyp fields. Fix keywords.
4. Image: replace it only if it contradicts the sources. A new image has NO fauna and must go through images-thumbs.py (see rules.md).
5. Check that every diff hunk is inside "{KEY}", run the build check, then commit and push.
   gh pr create --base bot/overnight-work --title "Audit {KEY} locality page" with a body containing:
   - Findings: what was wrong before.
   - Sources: one bullet per claim, with the URL and a verbatim quote.
   - Open questions: anything for the user to decide, e.g. name renderings, ambiguous IDs, pins. If there are none, "None".
6. Review loop, at most 4 rounds: run Codex exactly as in docs/locality-audit/codex-review.md and post its output as a PR comment.
   - VERDICT: CHANGES → fix the blockers (or rebut them in a PR comment with evidence, if Codex is wrong), push, and review again.
   - VERDICT: APPROVED → done. Fix any minor issues you agree with first, but don't run another round for them.
7. Final report (short): PR number, final verdict, rounds used, open questions.
```
