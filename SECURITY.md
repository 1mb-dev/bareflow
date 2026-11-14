# Security

Report a vulnerability privately through GitHub: the repository's Security tab, "Report a
vulnerability". Do not open a public issue for it.

Only the latest release is supported.

In scope:

- The fetch policy (`src/fetch-policy.js`, `src/ssrf.js`), shared by the CLI and the web: a fetch
  that reaches a private, loopback, or link-local address, a scheme other than http(s), more than
  5 redirects, or more than its time or byte budget.
- The `/_fetch` Function (`functions/_fetch.js` -> `src/edge.js`): a fetch without a valid Turnstile
  token, or a response that carries the target's headers or more bytes than the web limit.
- The web result view (`site/`): page text that runs script, writes HTML, or links outside
  http(s) and mailto, and anything that weakens the CSP in `site/_headers`.
- The Markdown and JSON renders: page text that forges bareflow's header or loss notes, or opens
  Markdown structure of its own (README, "Trust").
- Conversion (`src/convert.js` and what it runs) and the result view's render: a page that holds
  the CLI or a browser tab past the conversion deadline or the depth and element limits without
  being refused; a page under the byte limit whose conversion time grows faster than its size; a
  render that hangs the tab after conversion; a page that changes JavaScript's built-in objects.
  Known: pages dense with links near the web limit are refused as too slow.

Out of scope: what a converted page says (bareflow keeps its words, true or not), a lost part of a
page that bareflow marks as a loss, a page past the depth, element, or byte limits refused there, and
draining the /_fetch quota before rate limiting ships.
