# mdflow IR, `mdflow/ir/v2`

The JSON render (`mdflow <url> --json`) is this object. `validate()` in `src/ir.js` is the
contract; `test/golden/surface.json` pins its shape, and verify fails on any change until
`node src/verify.js --bless-surface` rewrites it. Everything that came from the page is untrusted
text.

## Document

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"mdflow/ir/v2"` | Bumped on any breaking change. |
| `id` | string | sha256 of the final URL, first 16 hex. |
| `title` | string | Page title, plain text, one line. |
| `source` | `{ url, finalUrl, retrievedAt, fingerprint, input }` | `url` as asked, `finalUrl` after redirects, ISO time, sha256 of the fetched bytes or, with no fetch, of the HTML (first 16 hex). `input`: `"fetch"` (the CLI fetched it), `"edge"` (the web Function fetched it), or `"paste"` (a person gave the HTML; `url` is their assertion). |
| `generator` | `{ name, version, extractor, extractorVersion }` | mdflow and Defuddle versions. |
| `scope` | `{ kind: "page", prev?, next? }` | One page. `prev` / `next`: `{ url, via: "rel" \| "pager" }`, the page's own nav, same-origin, never fetched. |
| `breadcrumbs` | `[{ title, url }]` | Where the page sits, same-origin; else `rel=up`. |
| `sections` | `[Section]` | Exactly one: the page. |

Same snapshot + same version + same `retrievedAt` gives byte-identical JSON and Markdown.

## Section

`{ id, title, url?, blocks: [Block], losses: [Loss], children: [Section] }`

## Inline text

Prose fields (heading and paragraph `text`, list `items`, blockquote `text`, table cells) are
inline Markdown: mdflow's own `**`, `*`, links, images, and code spans around page text, which is
escaped where it joins them, so it opens no construct of its own:

- `` ` `` `*` `[` `]` `~` always; `_` unless both neighbours are letters or digits; `\` before
  punctuation; `<` before a letter, `/`, `!`, `?`; `&` before an entity-like run (`&amp;`,
  `&#10;`); `|` in table cells. At the end of a text run, where mdflow's syntax may follow, `\`
  `<` `&` `!` are escaped too.
- At the start of a paragraph, list item, or quote: `#` `>` `+` `-`, and the `.` or `)` after a
  leading number. A heading's closing `#` run.
- A link or emphasis holding elements (an image, code) keeps them as inline Markdown; with no
  content it is left out.
- Link and image targets: http(s), mailto, or relative (read as a browser reads them, entities
  decoded); any other scheme keeps the text only. Whitespace is percent-encoded and `( ) \` escaped.
- The only line break in a prose field is `"\n"`, from `<br>`; other HTML whitespace collapses.

Code (`code` blocks, code spans) is verbatim and not escaped. To compare a prose field with page
text, remove the backslash escapes.

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

`{ type: "loss", reason, source, text? }`: a finding, not content; `validate` requires `source`.
It is one of:

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
`mdflow`, `source`, `final`, `retrieved`, `fingerprint`, `input`, `prev`, `next`, `up`, `losses`,
`content`. URL values are parser-serialized http(s); `final`, `prev`, `next`, and `up` are chosen
by the server or the page, and one holding a `'` is left out.

Then the page: the section title as `#`, each block, a prose field's `"\n"` written as `<br>`,
adjacent lists of one kind with alternating markers so they stay two. The title and an image's
alt are escaped as page text. A block image without an http(s) `src` becomes its alt as a
paragraph, or, with no alt, an `extract-unrepresentable` loss.

Then, when there are losses, one heading, `## mdflow: 1 loss (fingerprint F)` or
`## mdflow: N losses (fingerprint F)` with F the header's fingerprint, and one note per loss:

- `L<n> <source>: <label>` and the loss text in a fence longer than any backtick run inside it;
- for `extract-flattened`, `audit-scope-empty`, `audit-truncated` (no page text):
  `L<n> <source>: <reason>`, no fence.

Render losses against the IR: hard line breaks become `<br>`, a withheld header URL, a non-http(s)
image `src`, anchors and IDs.
