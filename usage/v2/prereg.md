# Gate v2: pre-registration

Registered 2026-09-27, before any sibling-projection code. Nothing below changes after this commit;
a change is a logged deviation. Tasks: `tasks.json`. Pages: `pages/`, sha256 in `pages.json`.

## Question

Does the document-unit window help an agent answer real developer questions, at an input cost
the window can carry? MLP go/no-go; n = 12 detects large effects only, not a claim.

## Tasks

12 real questions, picked by a delegated agent with a fixed rule, blind to mdflow's output
(`selection/`): walk a fixed repo list in order (fastapi, pydantic, vite, vitest, docusaurus,
ruff, prisma, tailwindcss, cargo, sphinx, polars, hono, astro, biome); per repo take the newest
answered Q&A discussion (issue labelled question where Discussions are off) created before
2026-09-20 whose answer is in the official docs; skip sites already in the corpus. Selections
were frozen to a file before any classification. Skips and reasons: `selection/skipped*.json`
(polars and astro yielded nothing: no Discussions, no question label). The same agent then chose
each landing page (the doc the answer links, else the best title match), classified page
crossing, and wrote each rubric with doc URLs and quotes. `question` is the agent's one-sentence
statement of the discussion, not a verbatim copy.

Crossing, as classified: 8 of 12 cross a page (T2 T4 T5 T6 T7 T8 T10 T11). The scope falsifier
(fewer than 1 in 5 cross) is not met.

## Arms

- A: `mdflow --json` of the landing URL, compact, window composed from the frozen siblings, built
  by `arms.js` at the run commit (the projection lands between this commit and the run).
- B: the landing page as plain text (`../plain.js`, the step-6 plain arm).
- C: no document.

One run per task per arm (36). Model: Sonnet, via Claude Code subagents. Prompt, identical across
arms except the attachment line:

> A developer asked the question below. Answer it as you would for them: the explanation, and
> any code or config they need. If a documentation file is attached, use it as your source where
> it helps; you may also use what you already know. After each factual claim, mark [doc] if it
> comes from the attached file, [memory] if it does not. Do not browse the web and do not run
> code. Write only your answer to `<out path>`.
>
> Question: `<question>`
>
> Attached documentation: `<path>` (arms A and B only)

No web and no code execution are instructions, not enforced by the tooling.

## Grading

One grader agent (Opus), blind: per task it sees the three answers as X, Y, Z (permutation of
A, B, C seeded by sha256 of the task id + "gate-v2"; the map is computed after grading), plus the
rubric from `tasks.json`. For each answer it scores each `must_contain` claim 1 (present and
correct, in substance) or 0, and each `wrong` claim 1 (made) or 0, with a one-line reason each.
Pass = every `must_contain` scored 1 and no `wrong` scored 1. Score = count of `must_contain`
scored 1 minus count of `wrong` made. The owner spot-checks the grading of 3 tasks. Offline
checks (`check` in `selection/classified12.json`) are not run.

## Decision rules

- Retained: tasks where C does not pass.
- Quality: per retained task, d = score A - score B. Go if wins (d > 0) minus losses (d < 0) >= 2.
  Harm flag if losses >= 2.
- Cost: R = bytes(A) / bytes(B) per task, UTF-8 bytes of each input as written. T = 1.5: pass
  R <= 1.05, fail R >= 1.95, otherwise inconclusive. Cost holds if fails <= 2 of 12; the cost
  verdict is inconclusive if more than 4 of 12 are inconclusive.
- Verdict: quality go + cost holds = MLP go. Quality go + cost fails = the projection needs work,
  not the scope. Quality no-go = the window is not the core on real tasks: reconvene (version
  pinning, page-only default).

Reported, never decides: pass counts per arm; the cost split (page text, sibling text, format
overhead); reach (a rubric quote found in A's window but not in B's page); [doc] / [memory]
counts; agent total tokens (harness) per run.

## Before the run

`baseline-unprojected.json`: the arms as the code stands at this commit (no projection). R per
task, T1..T12: 3.22 2.92 4.22 1.55 1.96 2.90 1.75 0.85 2.69 1.99 2.69 5.06. Unprojected, 9 fail,
2 are inconclusive and 1 passes: cost does not hold without the projection. T8's page text in A is 1.4 kB
against 4.9 kB plain: a possible extraction loss, recorded here and not fixed before the run.

## Deviations from the scope ruling (7), stated before the run

- Tasks are a real sample by a fixed rule, not designed per category. Version drift is covered by
  arm C (a task C passes is dropped); sibling-irrelevant tasks occur naturally (4 of 12).
- No designed lossy pages: the loss auditor is frozen and this gate does not score it. Its
  re-entry set is a separate step.
- The implementer saw mdflow's live window for T1..T5 while checking the sample. Rubrics come
  from the selection agent, not from the window.
- Grading is rubric-only (step 6 ran each deliverable); the checks are too heterogeneous to run
  offline for 36 answers.

## Code freeze

The run uses one commit, recorded in `log.md` with each arm input's sha256. No change to `src/`
between building the arms and grading.
