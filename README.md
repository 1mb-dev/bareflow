# mdflow

**Remove the website. Preserve the document.**

mdflow is a deterministic, faithful, versioned document layer for technical web content. Give
it a URL and get the document, not the website around it, as a typed document tree. The
canonical form is the IR; Markdown and JSON are renders of it.

The unit is the document, not the page: mdflow wraps a page in its navigation shell (breadcrumb
ancestors plus prev/next siblings) so a docs section can be addressed as one tree. The
transformation is deterministic for a fixed snapshot, and every loss it can detect is marked in
the output, never silently passed through.

## Status

Phase 1. The core pipeline (fetch -> extract -> IR -> Markdown/JSON) is implemented, with a
versioned snapshot, a navigation shell, structured loss markers, and a loss-marker inventory
gate over frozen fixtures (40/40). The document-unit composer follows rel=prev/next to
attach real sibling content (bounded, not a crawl). Extraction is composed (Defuddle), not
built from scratch; the moat is the contract downstream of extraction.

Loss reporting is bounded: mdflow marks (a) post-extraction unrepresentable content and
(b) source headings, code blocks, and tables the extractor dropped, via a source-to-IR diff.
Loss markers are findings, not content: they live in `section.losses`, not the block stream.
Prose loss (a paragraph dropped while its heading survives) is not yet detected.

## Run

```
npm install
node bin/mdflow.js <url>          # Markdown
node bin/mdflow.js <url> --json   # the typed IR
npm run verify                    # the loss-marker inventory gate
```

## License

MIT
