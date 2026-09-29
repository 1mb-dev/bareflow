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
