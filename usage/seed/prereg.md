# Seed: pre-registration (MLP v1 P3)

Registered 2026-10-04, before P1. Nothing below changes after this commit; a change is a logged
deviation. Plan: MLP v1 P3 (huddle 2026-10-04). Tasks: `tasks.json`. Pages: `pages/`, sha256 in
`tasks.json`. Rubric: committed after grading; its sha256 is fixed here.

## Question

On docs fetches where model memory is unlikely to hold the answer, does an agent answer better
from mdflow's page Markdown than from Claude Code's WebFetch? Stop rule for the MLP plan; n = 5
detects only large effects.

## Tasks

5 tasks, picked by a delegated agent with a fixed rule, blind to mdflow output (never ran it on
these pages). Walk a fixed repo list in order: oven-sh/bun, denoland/deno, withastro/astro,
sveltejs/kit, drizzle-team/drizzle-orm, TanStack/query, pnpm/pnpm, nuxt/nuxt,
remix-run/react-router, vercel/next.js, eslint/eslint, prettier/prettier, rolldown/rolldown,
oxc-project/oxc (no host already in test/ or usage/). Per repo, stable releases published
2026-07-01..2026-09-30, newest first, at most 3; in each, feature entries in order; the first
entry naming a user-facing option, flag, key, command, or API whose official docs page, frozen,
contains the identifier verbatim wins. One task per repo, first 5 repos. Skips and reasons:
`selection/skipped.json`. The same agent wrote each question ("How do I ... ? Show the exact
...") and the rubric from the frozen page only, with verbatim quotes; at least one claim per task
is exact syntax.

Rule v1 (release notes link a docs page on the official host) was tried first and dropped before
any classification: 2 of 11 repos qualified, and those links were blog/install pages.

| Task | Repo, release | Landing page |
|---|---|---|
| S1 | denoland/deno v2.9.5 (2026-08-06), `deno add --unscoped` | docs.deno.com/runtime/reference/cli/add/ |
| S2 | withastro/astro 7.3.5 (2026-09-24), container `renderComponent()` | docs.astro.build/en/reference/container-reference/ |
| S3 | eslint/eslint v10.11.0 (2026-09-18), object-shorthand `ignoreConstructors` | eslint.org/docs/latest/rules/object-shorthand |
| S4 | rolldown/rolldown v1.2.10 (2026-09-23), `addWatchFile` on directories | rolldown.rs/reference/Interface.PluginContext |
| S5 | oxc-project/oxc oxlint_v1.86.0 (2026-09-28), `allowCompoundComponents` | oxc.rs/docs/guide/usage/linter/rules/react/only-export-components.html |

Rubric: 5 tasks, 2-3 `must_contain` (at least one `exact`) and 1-2 `wrong` each, every quote
checked against the frozen page text. sha256 of `rubric.json` as written by the selection agent:
`d675373d6c7c3951fa2a6688be82c5091079b1161cc064c7279fcce8443482e2`. Kept outside the repo until
grading, then committed unchanged.

Deviations at selection, stated before any run:

- The strict rule yielded 4 repos (deno, eslint, rolldown, oxc). S2 is the agent's fallback: the
  first skipped repo in list order with an "Adds a new ..." entry under a changeset "Patch
  Changes" heading (astro). Not the rule as written.
- Sub-package tags (`@astrojs/*`, `oxlint_*`) counted as the repo's releases.
- S3 and S4 qualify on an identifier that predates the release (`ignoreConstructors`,
  `addWatchFile`); the new behaviour (quoted properties, directories) is the release's change,
  and the S3 page does not mention quoted properties. Both are likelier answerable from memory,
  which biases toward ties, against mdflow.

## Arms

Run at the P3 commit (after P2), both arms within one hour, live (the product path):

- W: Claude Code WebFetch, `url` = landing URL, `prompt` = the question verbatim. The returned
  text is the attachment, saved as returned.
- M: `node bin/mdflow.js <landing URL>` (page-only Markdown, default flags). Stdout is the
  attachment.

Then one answer run per task per arm (10). Model: Sonnet, via Claude Code subagents. Prompt,
identical across arms (gate v2 prompt):

> A developer asked the question below. Answer it as you would for them: the explanation, and
> any code or config they need. If a documentation file is attached, use it as your source where
> it helps; you may also use what you already know. After each factual claim, mark [doc] if it
> comes from the attached file, [memory] if it does not. Do not browse the web and do not run
> code. Write only your answer to `<out path>`.
>
> Question: `<question>`
>
> Attached documentation: `<path>`

Isolation (lessons 2026-09-29): each run in its own scratch dir with an opaque random name,
holding only its attachment; the rubric is not under the repo or any run dir. Every transcript
is audited before grading for any read outside its run dir and any web tool; a run that does
either is discarded and rerun, logged.

## Grading

One grader agent (Opus), blind: per task it sees the two answers as X and Y (order by the low
bit of `sha256(id + "seed")[0]`; the map is written after grading), the question, and the rubric.
Each `must_contain` claim scores 1 (present and correct in substance; an `exact` claim only if
its literal string appears) or 0; each `wrong` claim 1 (made) or 0; one-line reason each.
Score = must_contain hits - wrong made. The owner spot-checks 2 tasks.

## Decision rule

d = score(M) - score(W) per task. mdflow preferred where d > 0. **Go to P4 if preferred >= 3 of
5.** Otherwise stop and reconvene on the plan with this log. Harm flag if d < 0 on >= 2.

Reported, never decides: whether each exact-syntax string appears in the W and M attachments
themselves; bytes of each attachment; [doc] / [memory] counts; page drift (sha256 of a curl at
run time vs the frozen page).
