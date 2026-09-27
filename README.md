# mdflow

**Remove the website. Preserve the document.**

mdflow is a deterministic, faithful, versioned document layer for technical web content. Give
it a URL and get the document, not the website around it, as a typed document tree. The
canonical form is the IR; Markdown and JSON are renders of it.

The unit is the document, not the page: mdflow attaches a page's prev/next siblings and records
where it sits in the site (`doc.breadcrumbs`). `doc.scope` says what the result covers: one
page, or a prev/next window onto a docs section, never the whole section. The transformation
is deterministic for a fixed snapshot, and every loss it can detect is marked in the output,
never silently passed through.

## Status

Phase 1. The core pipeline (fetch -> extract -> IR -> Markdown/JSON) is implemented, with
structured loss markers and a truth gate that scores the loss audit and nav detection against
hand-labelled frozen fixtures. Loss recall is 0.95. Loss precision is 0.50 over 17 pages: 0.73
on the 15 docs pages the auditor was tuned on, and 0 of 12 findings correct on the two blog
pages added afterwards, where every false positive is chrome inside the main landmark (related
posts, author bio, comments). The auditor is fitted to docs generators; its precision gate
(~0.8) failed and was waived by the owner, not passed. Nav precision is 1.00, recall 0.74. The composer follows standard
rel=prev/next (on `<link>` and `<a>`) to attach real sibling content: a bounded window, marked
as one in `doc.scope`, not a crawl. The IR is versioned (`mdflow/ir/v1`); that a pinned
snapshot version serves a consumer is unproven until one pins it. Extraction is composed
(Defuddle), not built from scratch; the moat is the contract downstream of extraction.

Loss reporting is bounded: mdflow marks (a) post-extraction unrepresentable content and
(b) source headings, code blocks, and tables the extractor dropped, via a source-to-IR diff.
Loss markers are findings, not content: they live in `section.losses` in the JSON, not the
block stream, and the Markdown render omits them.
Prose loss (a paragraph dropped while its heading survives) is not yet detected.

## Trust

The JSON render is the contract; treat everything in it that came from the page as untrusted
input. Loss markers carry the dropped block's source `text` (hidden content is not audited).
URLs in `doc.scope` and `doc.breadcrumbs` come from the page's own navigation: mdflow fetches
only same-origin prev/next siblings and checks them against its SSRF policy, but it does not
check breadcrumb URLs, and an agent that follows any of these URLs makes its own request. The
Markdown render carries no loss markers; read them from the JSON.

## Run

```
npm install
node bin/mdflow.js <url>          # Markdown
node bin/mdflow.js <url> --json   # the typed IR
npm run verify                    # truth gate: loss + nav precision/recall per fixture
```

## License

MIT
