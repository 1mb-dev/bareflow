# bareflow

**Remove the website. Preserve the document.**

Give bareflow a docs page's URL and it returns the page as Markdown, or as a typed JSON tree (the IR), with a note for each loss it detects. The same page bytes and version give the same output, byte for byte, but for `retrieved`, the fetch time, in the header.

https://bareflow.1mb.dev runs the same conversion in the browser.

## Use

```
npx -y bareflow <url>            # Markdown: header, page, loss notes
npx -y bareflow <url> --json     # the IR, specified in docs/ir.md
npm i -g bareflow                # or install it, then: bareflow <url>
```

Node 22.15 or later. Exit 0 with the page on stdout; 1 when the fetch or conversion fails, with the reason on stderr; 2 on a usage error. There is no library API: the package is the CLI and `bareflow mcp`.

A fetch has 30 s in total, redirects included. The conversion has 20 s and up to 1536 MB of heap (a V8 heap flag in NODE_OPTIONS replaces that cap). A page that is not HTML, is over 5 MB, nests past 256 levels, holds over 50,000 elements, or keeps no readable text (a page built by JavaScript) is refused with a named reason.

## MCP

`bareflow mcp` serves one tool, `fetch_doc`, over stdio: the CLI's fetch and conversion, Markdown unless the call asks for `format: "json"`.

```
{"mcpServers": {"bareflow": {"command": "npx", "args": ["-y", "bareflow", "mcp"]}}}
```

A 400 KB result is about 100k tokens in one call. Claude Code saves a result over its size ceiling to a file, which a session without file tools cannot read. fetch_doc asks Claude Code for a ceiling of 500,000 characters; Claude Code's docs say that overrides MAX_MCP_OUTPUT_TOKENS for this tool.

## Why

An agent that reads docs through a summarizing fetch (Claude Code's WebFetch, for one) gets a model's paraphrase: short, and silent about what it left out. bareflow gives it the page, with a header saying where the page came from and a note for anything it could not keep.

Measured on 5 pre-registered questions about features released July to September 2026, on docs pages frozen before the run: one agent answered from WebFetch, another from bareflow 0.4.0 (then named mdflow), and a blind grader scored both. bareflow's answer was better on 3 (one a borderline call), tied on 2, worse on none. The questions, WebFetch outputs, answers, and grades are in `usage/seed/`; the frozen pages and bareflow's outputs are at commit d3917fd.

For `deno add --unscoped`, WebFetch returned 457 bytes ending in its own gloss ("This flag strips the scope prefix, allowing you to import the package using only its base name"); the answer built on it could not say what the docs' last sentence does. bareflow's output (excerpt):

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

The cost is size: over the five pages bareflow's output was 19 times WebFetch's (67704 against 3529 bytes).

## What it catches

Extraction is [Defuddle](https://github.com/kepano/defuddle)'s; bareflow's work is the IR, the loss audit, and the render.

bareflow notes the headings, code blocks, and tables the extractor dropped, the headings and code blocks it turned into prose, embeds the IR cannot hold, and a page whose structure flattened (its header says so). Hidden elements are not audited. In Markdown the notes follow the page, one per loss with the dropped text verbatim; in the JSON they are `section.losses`. Each loss carries a position field, `at`, which 0.5.1 leaves null.

It misses prose loss: a paragraph dropped under a surviving heading. A heading the extractor moves out of source order can make a nearby heading or code block that became prose read as dropped; the note still holds that block's text.

Scored against hand-labelled frozen pages:

- Loss recall 0.97, precision 0.60 over 29 pages: precision 0.81 on the 27 docs pages, and 0 of 12 notes were real losses on the two blog pages, where related posts, author bios, and comments inside `<main>` read as losses. The audit is fitted to docs sites.
- bareflow records a page's prev and next (from `rel=prev/next`, else the Docusaurus or VitePress pager) and its breadcrumbs, and fetches none of them. Nav precision 1.00, recall 0.89.


Wrong output, or a loss with no note: [open an issue](https://github.com/1mb-dev/bareflow/issues/new?template=wrong-output.md); the template asks for the header.

## Trust

The JSON is the contract ([docs/ir.md](docs/ir.md), `bareflow/ir/v4`; a breaking change bumps the schema). Treat everything in it that came from the page as untrusted. The URLs in `doc.scope` and `doc.breadcrumbs` come from the page's own navigation and are held to its origin; an agent that follows one makes its own request.

The Markdown header's values are bareflow's own, the URL you gave, or URLs the server or the page chose (`final`, `prev`, `next`, `up`). Page text is escaped where it joins Markdown, so it opens no structure of its own. The loss notes sit under `## bareflow: N losses (fingerprint ...)` with the header's fingerprint (sha256 of the bytes read, first 16 hex); a page cannot know its own, so a lookalike heading in page text shows a different one.

## Development

```
git clone https://github.com/1mb-dev/bareflow && cd bareflow
npm ci
npm link                         # bareflow on PATH from the clone
npm run verify                   # the gate: loss and nav scores, renders, CLI and IR surface, the web app
npm run bundle                   # dist/bareflow.js: convert() for the browser
```

`bin/` and `src/` are the CLI and the MCP server. `site/`, `functions/`, and `wrangler.toml` are the web app: the same `convert()` in a browser worker, behind one fetch-only Function. `scripts/` builds and checks the web app and the package. `test/` holds the frozen pages and goldens; `usage/` the eval records, written under the old name. `docs/voice.md` sets the wording of every string bareflow shows. Security reports: SECURITY.md.

## License

MIT. The frozen pages in `test/` and the page text quoted in `usage/seed/` belong to their publishers and are not covered by it; NOTICE lists them.
