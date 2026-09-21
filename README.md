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
gate over frozen fixtures. The gate is green (15/15). The document-unit composer builds nav
stubs, not a full site crawl. Extraction is composed (Defuddle), not built from scratch; the
moat is the contract downstream of extraction.

Loss reporting is bounded: mdflow marks (a) post-extraction unrepresentable content and
(b) source headings the extractor dropped, via a source-to-IR diff. Paragraph or code loss where
a heading survives is not yet detected. On the Python tutorial, Defuddle drops the "3.1 Using
Python as a Calculator" section; mdflow flags it as a loss block rather than passing it silently.

## Run

```
npm install
node bin/mdflow.js <url>          # Markdown
node bin/mdflow.js <url> --json   # the typed IR
npm run verify                    # the loss-marker inventory gate
```

## License

MIT
