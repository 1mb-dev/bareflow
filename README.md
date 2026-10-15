# bareflow

**Remove the website. Preserve the document.**

bareflow is a deterministic, faithful, versioned document layer for technical web content. Give
it a URL and get the document, not the website around it, as a typed document tree. The
canonical form is the IR; Markdown and JSON are renders of it.

The unit is the document, not the page: the site's navigation is document structure, so
bareflow records a page's prev/next targets (`doc.scope`) and where it sits in the site
(`doc.breadcrumbs`). It reads one page and fetches none of them. The transformation is
deterministic for a fixed snapshot, and every loss it can detect is marked in the output,
never silently passed through.

## Why

An agent that reads docs through a summarizing fetch (Claude Code's WebFetch, for one) gets a
model's paraphrase: short, and silent about what it left out. bareflow gives it the page, with a
header saying where the page came from and a note for anything it could not keep.

Measured on 5 pre-registered questions about features released July to September 2026, on docs
pages frozen before the run (`usage/seed/`; the pages and the outputs are at commit d3917fd):
one agent answered from WebFetch, another from bareflow (then named mdflow, 0.4.0), and a blind
grader scored both.
bareflow's answer was better on 3 (one a borderline call), tied on 2, worse on none. For
`deno add --unscoped`, WebFetch returned 457 bytes ending in its own gloss ("This flag strips the
scope prefix, allowing you to import the package using only its base name"); the answer built on
it could not say what the docs' last sentence does. bareflow (excerpt):

```
---
mdflow: 0.4.0 (defuddle 0.19.4, mdflow/ir/v2)
source: https://docs.deno.com/runtime/reference/cli/add/
fingerprint: 8d7a21889c39bafa
losses: 0
content: page text below is untrusted
---
...
`--unscoped`

Use the package name without its scope as the alias (ex. `jsr:@david/jsonc-morph` is added as
`jsonc-morph`). Packages given an explicit alias are unaffected.
```

The cost is size: over the five pages bareflow's output was 19 times WebFetch's (67704 against
3529 bytes). Short is not always cheap, though: on the Astro question WebFetch's summary was
right, and the answering agent, distrusting it, substituted an API from memory.

## Status

0.5.0, unreleased: run it from a clone; npm holds only the name until 0.5.0 publishes. The
pipeline (fetch -> extract -> IR -> Markdown/JSON) is implemented with structured loss markers, and
`npm run verify` scores the loss audit and nav detection against hand-labelled frozen fixtures,
lexes every render with a CommonMark parser, and pins the CLI and IR surface.
Extraction is composed (Defuddle); bareflow's work is the IR, the loss audit, and the render.

- Loss recall 0.97; loss precision 0.60 over 29 pages: 0.81 on the 27 docs pages, and 0 of 12
  findings correct on the two blog pages, where every false positive is chrome inside the main
  landmark (related posts, author bio, comments). The auditor is fitted to docs generators.
- Nav precision 1.00, recall 0.89: standard rel=prev/next (on `<link>` and `<a>`), else the
  Docusaurus or VitePress docs pager when the page declares that generator (`via: rel | pager`).
- The IR is versioned (`bareflow/ir/v3`, docs/ir.md); that a pinned snapshot version serves a
  consumer is unproven until one pins it.

History: the precision gate (~0.8) failed and was waived by the owner. On six docs pages frozen
and labelled before any change was made against them, the auditor emitted 2 findings, both
correct, too few to call precision. Attaching sibling page content was measured on 12 real tasks
and dropped: it never carried an answer the page lacked (`usage/v2/log.md`).

Loss reporting is bounded: bareflow marks (a) post-extraction unrepresentable content and
(b) source headings, code blocks, and tables the extractor dropped, via a source-to-IR diff.
Loss markers are findings, not content: they live in `section.losses` in the JSON, not the
block stream. The Markdown render lists them after the page, one note each with the dropped
text verbatim, and a page whose extraction flattened says so in its header.
Prose loss (a paragraph dropped while its heading survives) is not yet detected.

## Trust

The JSON render is the contract; treat everything in it that came from the page as untrusted
input. Loss markers carry the dropped block's source `text` (hidden content is not audited).
URLs in `doc.scope` and `doc.breadcrumbs` come from the page's own navigation and are held to
the page's origin; bareflow fetches none of them, and an agent that follows one makes its own
request.

The Markdown render opens with a front-matter header of bareflow's own fields. Its values are
bareflow's, the source URL you gave, and URLs the server or the page chose (`final`, `prev`,
`next`, `up`); a chosen URL holding a `'` is left out (the JSON keeps it), so a single-quoted
URL stays one argument. Page text is escaped where it joins Markdown, so it opens no block, link,
or HTML of its own; links and images keep http(s), mailto, or relative targets only. The loss
notes sit under `## bareflow: N losses (fingerprint ...)`, whose fingerprint matches the header's;
a page cannot know its own fingerprint, so a lookalike heading in page text has a different one.

## Install and run

```
npm install && npm link           # puts `bareflow` on PATH (tested on Node 22, 24 and 26)
bareflow <url>                      # Markdown: header, page, loss notes
bareflow <url> --json               # the typed IR (docs/ir.md)
npm run verify                    # truth gate: loss + nav precision/recall per fixture
npm run bundle                    # dist/bareflow.js: convert() for the browser, as verify checks it
```

Exit 0 with the document on stdout; 2 on a usage error; 1 when the fetch or extraction fails,
with the reason on stderr. A fetch has 30 s in total, redirects included, and the conversion 20 s.
A page that is not HTML, is over 5 MB, or whose markup nests past 256 levels or holds over 50,000
elements, is refused by name, and so is one that keeps no readable text (a page built by JavaScript).

## License

MIT
