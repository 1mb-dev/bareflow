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
hand-labelled frozen fixtures. Loss recall is 0.97. Loss precision is 0.59 over 27 pages: 0.78
on the 25 docs pages, and 0 of 12 findings correct on the two blog pages, where every false
positive is chrome inside the main landmark (related posts, author bio, comments). The auditor is
fitted to docs generators; its precision gate (~0.8) failed and was waived by the owner, not
passed. On six docs pages frozen and labelled before any change was made against them, it
emitted 2 findings, both correct; that is too few to call precision. Nav precision is 1.00,
recall 0.88. The composer follows standard rel=prev/next (on `<link>` and `<a>`) and, where a
page declares Docusaurus or VitePress as its generator and rel is silent, that generator's docs
pager; `doc.scope` records which (`via: rel | pager`). It attaches real sibling content: a
bounded window, marked as one in `doc.scope`, not a crawl. Siblings are projected by default:
their headings and code blocks, whole and verbatim, with a count of each block type left out
(`scope.siblings.*.projection`) and the UTF-8 bytes of what was kept (`text_bytes`, null for a
sibling never read). `--siblings full` keeps every block. The IR is versioned (`mdflow/ir/v1`); that a pinned
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
node bin/mdflow.js <url> --siblings full   # siblings unprojected (worker: &siblings=full)
npm run verify                    # truth gate: loss + nav precision/recall per fixture
npm run reader                    # local reader: source | document | findings, http://127.0.0.1:4380/
```

The reader shows each frozen fixture and step-6 page next to its document (the prev/next window
where siblings are frozen), the audit's findings judged against the hand labels, and every label;
clicking a label finds it in the source. `/live?url=` runs a live page through the agent surface.
It writes nothing and binds 127.0.0.1 only.

## License

MIT
