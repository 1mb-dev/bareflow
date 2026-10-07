# Seed log (MLP v1 P3)

Method: `prereg.md` (26b5294). Entries as run; corrections are logged as such.

## Run, 2026-10-04

Run commit: `337fe82`. Started 05:17Z; both arms within 10 minutes. Page drift: none (sha256 of
a curl at run time equals the frozen page on all 5; mdflow's fingerprint matches too).

- W: Claude Code WebFetch, landing URL, prompt = question verbatim; saved as returned (`runs/<S>/W.md`).
- M: `node bin/mdflow.js <landing URL>`, default flags (`runs/<S>/M.md`).
- 10 Sonnet answer runs, prompt verbatim, each in its own scratch dir with an opaque random name
  holding only `doc.md`; answers in `runs/<S>/answer-{W,M}.md`. Transcript audit before grading:
  every run made exactly Read (its doc.md), Write (its answer.md); no other read, no web tool.
- One Opus grader, blind (X/Y by the low bit of `sha256(id + "seed")[0]`, `runs/permutation.json`
  written after grading), read only its input file (audited: Read, Write). Grades `runs/grades.json`,
  scoring `score.js` -> `runs/score.json`. Rubric `rubric.json`, sha256 d675373d... as registered.

| Task | M | W | d | exact syntax in attachment W/M | attachment bytes W/M | [doc]/[memory] W, M |
|---|---|---|---|---|---|---|
| S1 deno `--unscoped` | 3 | 2 | +1 | 1/1 | 457/6931 | 4/1, 8/1 |
| S2 astro `renderComponent()` | 3 | 2 | +1 | 2/2, 2/2 | 848/15889 | 4/5, 14/1 |
| S3 eslint `ignoreConstructors` | 3 | 2 | +1 | 1/1 | 409/11761 | 4/3, 6/3 |
| S4 rolldown `addWatchFile` | 3 | 3 | 0 | 0/0 (quote is a sentence) | 943/28305 | 6/2, 8/1 |
| S5 oxlint `allowCompoundComponents` | 2 | 2 | 0 | 0/1, 0/1 (quotes are sentences) | 872/4818 | 6/1, 10/4 |

preferred 3/5, losses 0, harm false: **go to P4** (rule: preferred >= 3).

Reading, per the rules: mdflow preferred on S1, S2, S3; ties on S4, S5; no loss. The verdict sits
exactly on the threshold, and one of the three wins is the grader's own borderline call:

- S3: W's answer said the option "works with" always/methods without "only"; the grader scored
  the restriction claim 0 and flagged it borderline. A lenient reading makes S3 a tie, and the
  count 2/5 (stop). The table stays as graded; the owner spot-check should include S3.
- S1: the WebFetch summary left out that an explicit alias is unaffected; W's answer could not say it.
- S2: WebFetch's summary was right (`renderComponent`), but W's answer agent distrusted the short
  summary and substituted `renderToString` from memory; M's agent, given the page, did not.
- S5: both arms lost the same point to a rubric defect (the exact string is the bare "error" form,
  which cannot carry the option asked about). Flagged by the grader, not changed.

Limits: one model per role, ties dominate, and 2 of 5 tasks (S3, S4) were registered as
likelier answerable from memory. WebFetch output is about 1/19 the size of mdflow's page (3529
against 67704 bytes in all; 5.5 to 30 per task); the
cost comparison against WebFetch is not this gate's question. Owner spot-check: 2 tasks (suggest
S3 and S1), correction logged here, table unchanged.

Correction, 2026-10-04 (review ritual): the size ratio read "about 1/15"; the bytes column gives
1/19 overall, fixed above. The plan phases the prereg names (P2, P3, P4) are the MLP v1 plan's:
P2 the Markdown render, P3 this seed, P4 hardening (huddle record, kept outside the repo).

Removed in 0.5.0: frozen pages and M inputs (third-party page text), selection; W inputs,
answers, grades, scores, rubric and prereg stay. The full record is at commit 2ffc9d4.
