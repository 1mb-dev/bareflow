# Step-6 usage log

Run 2026-09-26. Tasks pre-registered in `tasks.md` (fa0bcab) by a delegated reviewer, blind to
the auditor. Pages frozen and labelled from source with audit findings stripped (1434b3a) before
any audit run. Inputs built by `arms.js` at bc22716; every number below is from that commit.

Waiver: the loss auditor's ~0.8 precision gate failed in increment 5 and was waived by the owner.
These numbers are a caveated log, not a verdict on the moat.

## Method

- Arm A: `mdflow --json` output (pretty-printed, as the CLI prints it), siblings attached from
  frozen copies. Arm B: the task page as plain text (`arms.js` plainText), the stand-in for an
  agent's fetch tool. Both arms get only the task URL's content; neither gets web access.
- One agent per task per arm (10), same model (Sonnet), same prompt apart from the file; the
  prompt does not name mdflow. Agents do not run code. Deliverables in `runs/<task>/out-{a,b}/`.
- Graded by the implementer against the pre-registered pass criteria, with actionlint,
  kubeconform, tsc + `playwright test --list`, cargo, python + SQLAlchemy 2.0.48, and
  `git ls-remote` / the GitHub API for SHAs.
- Tokens are estimated as chars / 4.
- Truth changes prompted by these pages, both before the run and applied to all fixtures (no
  existing fixture moved): a site title counts as carrying its page part ("Configuration |
  Playwright" carries h1 "Configuration"); NBSP in code reads as a space.
- Owner label spot-check deferred by the owner until the local reader is up. Any label change
  after this run is logged as a post-run correction with its effect on these numbers.

## Results

| Task | Site (generator) | Corpus | Pass A / B | ~Tokens A / B | Not in doc, A / B | Siblings (A) | Favours |
|---|---|---|---|---|---|---|---|
| U1 | SQLAlchemy (Sphinx) | out | pass / pass | 22.6k / 7.0k | 5 / 8 | attached, used (prev) | A |
| U2 | uv (MkDocs Material) | out | pass / pass | 7.1k / 3.5k | 0 / 0 | attached, unused (noise) | tie |
| U3 | Playwright (Docusaurus) | out | pass / pass | 2.8k / 1.7k | 4 / 4 | absent (no rel) | tie |
| U4 | Rust book (mdBook) | in | pass / pass | 11.0k / 3.7k | 0 / 4+ | attached, used (next) | A |
| U5 | Kubernetes (Hugo) | in | pass / pass | 7.1k / 10.7k | scaffold / scaffold | absent (no rel) | tie |

"Not in doc" counts what the agent reported using from its own knowledge rather than the file.
Hallucinated (nonexistent) APIs: 0 in both arms; every pinned SHA exists; every setup-uv input
exists at its SHA.

- U1: A took `Session.get` and `Session.delete` from the attached prev page; B took them from
  memory. Both arms saw "[email protected]": Cloudflare email obfuscation in the source.
- U4: A copied the final `lib.rs` (12-21) and `main.rs` with `eprintln!` (12-24, next page)
  verbatim, nothing from memory. B had no stderr listing, took `eprintln!` from memory, and moved
  `Config` into `lib.rs` to match an older edition of the book, against the page it was given.
- U3: neither arm had `screenshot` / `video` (they are on the next page, which Docusaurus links
  without rel); both filled them from memory.

## Audit on the task pages (vs `truth.json`)

| Task | Emitted | TP | FP | Demoted (correct) | Notes |
|---|---|---|---|---|---|
| U1 | 3 (+6 on siblings) | 0 | 3 | 0 | docs header and sidebar sit inside `<main>`; same 3 on each sibling |
| U2 | 0 | 0 | 0 | 0 | |
| U3 | 1 | 0 | 1 | 0 | page h1 kept only in the suffixed title |
| U4 | 0 | 0 | 0 | 0 | |
| U5 | 2 | 0 | 0 | 2 | "Note:", "Caution:" h4s demoted to paragraphs |

No labelled losses on these pages: recall is untested out of sample, precision on the page
findings is 0/4. No agent used a demoted finding. Code: every task-page code block round-trips
line for line against the truth harness.

## IR defects the agents found

- Tables written with optional end tags (`<th>Description<tbody>`) parse with the body inside
  the header cell: the header absorbs every row (U3; also nodejs-path).
- Inline `<code>` inside a k8s callout splits one sentence across five paragraph blocks (U5).
- A "Release: 2.0.54" chrome paragraph leads the SQLAlchemy page, so its h1 stays in the body as
  an h2 (U1, structure).
- Input cost: A is larger than B on 4 of 5 tasks. Siblings double or triple it, and the page
  alone is still larger because every inline link carries its full URL.

## Gates (plan step 6)

- Favour mdflow: 2/5 (U1, U4), under 3/5: reconvene on scope.
- Siblings helped: 2/5 (U1, U4). Both wins are sibling wins; no task was won on loss markers.
- Every run passed, so the pass criteria did not separate the arms; "favours" is judged on
  sourcing from the document rather than memory. n = 5, one model, implementer-graded.
