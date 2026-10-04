# mdflow IR, `mdflow/ir/v2`

The JSON render (`mdflow <url> --json`) is this object. `validate()` in `src/ir.js` is the
contract; `test/golden/surface.json` pins its shape, and verify fails on any change until it is
blessed. Everything that came from the page is untrusted text.

## Document

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"mdflow/ir/v2"` | Bumped on any breaking change. |
| `id` | string | sha256 of the final URL, first 16 hex. |
| `title` | string | Page title, one line. |
| `source` | `{ url, finalUrl, retrievedAt, fingerprint }` | `url` as asked, `finalUrl` after redirects, ISO time, sha256 of the fetched bytes (first 16 hex). |
| `generator` | `{ name, version, extractor, extractorVersion }` | mdflow and Defuddle versions. |
| `scope` | `{ kind: "page", prev?, next? }` | One page. `prev` / `next`: `{ url, via: "rel" \| "pager" }`, the page's own nav, same-origin, never fetched. |
| `breadcrumbs` | `[{ title, url }]` | Where the page sits, same-origin; else `rel=up`. |
| `sections` | `[Section]` | Exactly one: the page. |

Same snapshot + same version + same `retrievedAt` gives byte-identical JSON and Markdown.

## Section

`{ id, title, url, blocks: [Block], losses: [Loss], children: [Section] }`

## Block

| `type` | Fields |
|---|---|
| `heading` | `level` 1-6, `text`, `anchor?` |
| `paragraph` | `text` (inline Markdown) |
| `code` | `code` (verbatim, line layout kept), `lang?` |
| `list` | `ordered`, `items` (inline Markdown) |
| `table` | `headers`, `rows` (strings) |
| `blockquote` | `text` |
| `image` | `src`, `alt?` |

## Loss

`{ type: "loss", reason, source, text? }`: a finding, not content. `source` is one of:

| `source` | Meaning | `text` |
|---|---|---|
| `source-heading-diff` / `source-code-diff` / `source-table-diff` | In the page, not in the IR | The dropped block's source text |
| `source-heading-demoted` / `source-code-demoted` | In the IR, but as prose | The source text |
| `extract-unrepresentable` | Embed or widget the IR cannot hold | Start of its HTML |
| `extract-flattened` | The IR kept almost none of the page's structure | none |
| `audit-scope-empty` | The audit could not read the page | none |
| `audit-truncated` | Audit stopped at its cap | none |

`reason` is human-readable and can carry page text; key on `source`. Prose loss (a paragraph
dropped under a surviving heading) is not detected.

## Markdown render

Front matter of mdflow's own fields, in this order when present: `warning` (flattened page),
`mdflow`, `source`, `final`, `retrieved`, `fingerprint`, `prev`, `next`, `up`, `losses`,
`content`. URL values are parser-serialized. Then the page, then `## mdflow: N losses
(fingerprint ...)` with one note per loss: `L<n> <source>: <label>` and the loss text in a fence
longer than any backtick run inside it.
