# Codex review prompt (locality audit)

The auditor fills in `{KEY}`, `{PR}`, `{ROUND}` and `{REPO}`, then runs:

```
codex --search exec --skip-git-repo-check -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  -C <scratch dir> -i {REPO}/images/localities/thumbnails/{KEY}.jpg \
  -o <scratch dir>/review-{ROUND}.md - < <scratch dir>/review-prompt.md
gh pr comment {PR} --body-file <scratch dir>/review-{ROUND}.md
```

---

You review PR #{PR} (round {ROUND}). It audits ONE locality page of a fossil website: the entry `"{KEY}"` in `{REPO}/jsondata/geochronology.json` and its reconstruction image, which is attached.

Read first: `{REPO}/docs/locality-audit/rules.md`. Then read the diff: `gh pr diff {PR} -R tsioftas/tsioftolithomata`. Also read the PR description, which has the quoted sources, and the earlier review comments: `gh pr view {PR} -R tsioftas/tsioftolithomata --comments`.

Check:
1. **Every cited URL.** Fetch it with curl; for PDFs, use pdftotext on the cited page. Is the cited text really there? Does it support the sentence? Does it cover THIS locality? Is `#page=N` the PDF index of the right page? Does the text fragment exist?
2. **Claims without a citation**, including the short fields (`formation`, `age`, `depositional_environment`, `fossil_types`, `paleoecology_highlights`), which must follow from the cited sources.
3. **el, en and grc say the same thing.** Nothing is added or left out in one language.
4. **The language rules in rules.md**: no Latin in el/grc, Greek forms of names, grc grammar and vocabulary, Greek numerals, citation labels.
5. **Image**: does it contradict the sources? A NEW image must show no animals and must have the matte, oil-painting style.
6. **The diff** touches only this locality, plus its image files.

Don't rewrite the text. Report findings.

Output, in Markdown:
- `## Blockers`: claims that are unsupported or wrong, broken citations, rule violations. Give each one the field and language, what is wrong, and the evidence (a quote, or "not found on page N").
- `## Minor`: wording, style and nits. These don't block.
- The last line exactly: `VERDICT: APPROVED` (no blockers) or `VERDICT: CHANGES`.
