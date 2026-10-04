# Gate v2 log

Method: `prereg.md` (6ae1789). Entries are appended as run; corrections are logged as such.

## C1 code freeze, 2026-09-29

Run commit: `15070cba69099eb0bb2f6cfed12a9cff2252fadc`. No change to `src/` from here until
grading ends. Arm inputs built by `node usage/v2/arms.js` at that commit into `runs/<T>/`;
full sha256 and the cost split per task in `runs/summary.json`.

Fixes between the projection (a59da84) and the freeze, from its independent review:

- e42a739: `validate()` recounts `text_bytes` against the sibling's section and accepts only
  dropped block types in `projection.omitted` (`{}` under `full`).
- 429f9cb: `run()` rejects an unknown siblings mode.
- 15070cb: verify pins that sibling losses are never projected (real T2 window).

Demoted sibling code was reported as dropped. It is not dropped from arm A: its verbatim
source is in the sibling's `losses[].text`. Arm A has the same byte count as the a59da84
build on all 12 tasks. Left for after grading: worker cache-key test, CLI flag parsing, and
the Markdown render emitting losses (it emits none for any section; arm A is JSON).

| Task | A bytes | B bytes | R | Cost | sha256 A | sha256 B |
|---|---|---|---|---|---|---|
| T1 | 25847 | 12751 | 2.03 | fail | 9ba29d7fe751fd21 | fb47d4c9228c5ee5 |
| T2 | 51523 | 27655 | 1.86 | band | a1d73f69cf99e632 | cc78fd935ab9d7f6 |
| T3 | 37289 | 18958 | 1.97 | fail | ec6045105a9bd3f3 | 8a42e5b7d219baf8 |
| T4 | 27476 | 20393 | 1.35 | band | 2d57f5ddd28d971c | d28224c16f9a7af1 |
| T5 | 22230 | 13860 | 1.60 | band | 786dd2d2841a6c48 | dd8c539be1d0d058 |
| T6 | 34751 | 20378 | 1.71 | band | c23619bbeb00fed2 | 5200bcc54651ccf2 |
| T7 | 8501 | 4837 | 1.76 | band | 1aa8ed0403fdf597 | 185b74e2be2cd419 |
| T8 | 4254 | 4948 | 0.86 | pass | 2634d1bb2f5d1870 | 87c8be3b43ecaecf |
| T9 | 16647 | 8164 | 2.04 | fail | 3e978a2fcb4b7171 | c8a8ebd1e21deba4 |
| T10 | 86633 | 50265 | 1.72 | band | dcc4216bcb6372fa | 80f4ba81a0f65d38 |
| T11 | 14535 | 6798 | 2.14 | fail | fcba6a02b96e7398 | a082ba4188fac539 |
| T12 | 20751 | 8726 | 2.38 | fail | ced22e47b1c0af6d | 4d6eae4cabd43969 |

Cost reading, stated before the quality run: 5 fail, 6 band, 1 pass. Both cost rules
trigger (fails 5 > 2; band 6 > 4). Fails decide: a failed cost is a finding the band cannot
make inconclusive. Cost does not hold.

## C2 run and blind grade, 2026-09-29

36 Sonnet task runs (prompt verbatim; attachment and output paths in session scratch dirs),
then one Opus grader, blind (X/Y/Z = the permutation of a/b/c at index
`parseInt(sha256(id + "gate-v2")[0..8], 16) % 6` in lexicographic order; `runs/permutation.json`
written after grading). Answers `runs/<T>/out-{a,b,c}.md`, grades `runs/grades.json`, scoring
`score.js` -> `runs/score.json`. Harness tokens per run in `runs/tokens.json` (never decides).

Deviations, stated as run:

- Arm C agents, having no attachment, searched for one. 4 of 16 arm C runs read their own
  task's material: T1-c and T5-c the staged arm A/B inputs, T2-c `tasks.json` (the rubric) and
  arm A, T12-c the frozen page via `git show`. Each was discarded (`runs/discarded/`) and rerun
  with the arm A/B inputs cleared from disk and `usage/v2/` removed from the working tree
  (restored from git after). Every run's transcript was audited for reads outside its own
  directory; all 36 kept runs read nothing of their task beyond the prompt and attachment.
  Arm A/B runs never searched. Git history stays readable from the repo; the audit is the guard.
- Blinding: arm C answers state that nothing was attached, and A/B answers carry [doc] tags,
  both from the pre-registered prompt. The grader could tell C from A/B; A vs B is what d uses.
  One arm A answer names `doc.json`. No answer was edited.
- The grader read only its 12 input files (transcript audited). It flagged 4 rubric items:
  T4 W1 (says the storageState replay can work; scored 1 for all three arms, d unchanged),
  T10 M2, T3 M1, T12 M1 (lenient 1s). Rubrics were not changed.

| Task | A | B | C | kept | d | quotes in A/B | reach | R | cost | [doc] A/B | tokens A/B/C |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 2 P | 2 P | 2 P | n | - | 2/2 of 2 | 0 | 2.03 | fail | 11/10 | 55102/48532/47742 |
| T2 | 2 P | 2 P | 2 P | n | - | 1/1 of 2 | 0 | 1.86 | band | 15/0 | 72890/59738/53749 |
| T3 | 1 P | 1 P | 1 P | n | - | 0/1 of 1 | 0 | 1.97 | fail | 6/6 | 55116/46779/39054 |
| T4 | 1 | 2 | 1 | y | -1 | 0/0 of 3 | 0 | 1.35 | band | 1/4 | 57157/55785/54589 |
| T5 | 1 P | 1 P | 1 P | n | - | 0/0 of 1 | 0 | 1.60 | band | 5/2 | 56370/54341/52943 |
| T6 | 1 | 1 | 1 | y | 0 | 0/0 of 2 | 0 | 1.71 | band | 6/8 | 59413/54511/45353 |
| T7 | 2 P | 2 P | 2 P | n | - | 1/1 of 2 | 0 | 1.76 | band | 8/9 | 48867/45560/48427 |
| T8 | 3 P | 3 P | 3 P | n | - | 0/0 of 3 | 0 | 0.86 | pass | 3/4 | 45670/45919/44862 |
| T9 | 1 P | 1 P | 1 P | n | - | 1/1 of 1 | 0 | 2.04 | fail | 5/3 | 54857/57795/53627 |
| T10 | 2 P | 2 P | 2 P | n | - | 1/1 of 2 | 0 | 1.72 | band | 4/4 | 67576/66140/48502 |
| T11 | 2 P | 2 P | 2 P | n | - | 1/1 of 2 | 0 | 2.14 | fail | 5/3 | 54983/47681/46670 |
| T12 | 1 P | 1 P | 1 P | n | - | 1/1 of 1 | 0 | 2.38 | fail | 8/13 | 48792/43233/47613 |

retained 2: wins 0, losses 1, ties 1; harm false; quality no-go
cost: 5 fail, 6 band, 1 pass; holds false
passes A/B/C: 10/10/10
verdict: quality no-go: the window is not the core on real tasks, reconvene

Reading, per the rules: arm C passes 10 of 12, so 2 tasks are retained (T4, T6). d: T4 -1
(B names provide/inject, A does not), T6 0. Wins - losses = -1 < 2: quality no-go. Cost
fails (above). Verdict by prereg: the window is not the core on real tasks; reconvene
(version pinning, page-only default).

Limits on that reading: with C passing 10/12, this sample mostly measures what Sonnet already
knows; a document of either form changed no pass on 10 tasks, and only 2 tasks could show a
difference. Reach is 0 on all 12: the prev/next window carried no rubric quote the landing page
lacked, and 13 of 22 quotes sit on pages outside the window. T3's quote is in B but not in A:
a possible extraction loss, not investigated before C3.

C3 pending: owner spot-checks the grading of 3 tasks (suggested T4, T6, T12).

Scripts (`arms.js`, `freeze.js`, `score.js`, and `../plain.js`) removed in 0.3.0 with the sibling
path; run them from commit 873121e. Frozen pages, inputs, answers, and grades stay.
