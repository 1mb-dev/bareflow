# mdflow

**Remove the website. Preserve the document.**

mdflow is a deterministic, faithful, versioned document layer for technical web content. Give
it a URL and get the document, not the website around it, as a typed document tree. The
canonical form is the IR; Markdown and JSON are renders of it.

The unit is the document, not the page: the site's navigation is document structure, so
mdflow records a page's prev/next targets (`doc.scope`) and where it sits in the site
(`doc.breadcrumbs`). It reads one page and fetches none of them. The transformation is
deterministic for a fixed snapshot, and every loss it can detect is marked in the output,
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
recall 0.88. Nav follows standard rel=prev/next (on `<link>` and `<a>`) and, where a page
declares Docusaurus or VitePress as its generator and rel is silent, that generator's docs
pager; `doc.scope` records which (`via: rel | pager`). Attaching sibling page content was
measured on 12 real tasks and dropped: it never carried an answer the page lacked
(`usage/v2/log.md`). The IR is versioned (`mdflow/ir/v2`); that a pinned snapshot version
serves a consumer is unproven until one pins it. Extraction is composed
(Defuddle), not built from scratch; the moat is the contract downstream of extraction.

Loss reporting is bounded: mdflow marks (a) post-extraction unrepresentable content and
(b) source headings, code blocks, and tables the extractor dropped, via a source-to-IR diff.
Loss markers are findings, not content: they live in `section.losses` in the JSON, not the
block stream. The Markdown render lists them after the page, one note each with the dropped
text verbatim, and a page whose extraction flattened says so in its header.
Prose loss (a paragraph dropped while its heading survives) is not yet detected.

## Trust

The JSON render is the contract; treat everything in it that came from the page as untrusted
input. Loss markers carry the dropped block's source `text` (hidden content is not audited).
URLs in `doc.scope` and `doc.breadcrumbs` come from the page's own navigation and are held to
the page's origin; mdflow fetches none of them, and an agent that follows one makes its own
request. The Markdown render opens with a front-matter header of mdflow's own fields (source,
retrieval, fingerprint, versions, nav URLs, loss count); page text never reaches it, nor a loss
note's label, and page text in a note is fenced so it cannot close the fence.

## Install and run

```
npm install && npm link           # puts `mdflow` on PATH (tested on Node 26)
mdflow <url>                      # Markdown: header, page, loss notes
mdflow <url> --json               # the typed IR (docs/ir.md)
MDFLOW_LOG=~/mdflow-use.jsonl mdflow <url>   # also append one JSON line per use
npm run verify                    # truth gate: loss + nav precision/recall per fixture
npm run reader                    # local reader: source | document | findings, http://127.0.0.1:4380/
```

Exit 0 with the document on stdout; 2 on a usage error; 1 when the fetch or extraction fails,
with the reason on stderr. A fetch has 30 s in total, redirects included.

The reader shows each frozen fixture and step-6 page next to its document, the audit's findings
judged against the hand labels, and every label; clicking a label finds it in the source.
`/live?url=` runs a live page through the CLI's pipeline.
It writes nothing and binds 127.0.0.1 only.

## License

MIT
