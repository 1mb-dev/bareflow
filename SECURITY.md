# Security

Report a vulnerability privately through GitHub: the repository's Security tab, "Report a
vulnerability". Do not open a public issue for it.

Only the latest release is supported.

In scope:

- The fetch policy (`src/fetch-policy.js`, `src/ssrf.js`), shared by the CLI and the web: a fetch
  that reaches a private, loopback, or link-local address, a scheme other than http(s), more than
  5 redirects, or more than its time or byte budget.
- The `/_fetch` Function (`src/edge.js`): a fetch without a valid Turnstile token, or a response
  that carries the target's headers or more bytes than the web limit.
- The web result view (`site/`): page text that runs script, writes HTML, or links outside
  http(s) and mailto, and anything that weakens the CSP in `site/_headers`.
- The Markdown and JSON renders: page text that forges bareflow's header or loss notes, or opens
  Markdown structure of its own (README, "Trust").

Out of scope: what a converted page says (bareflow keeps its words, true or not), and a lost part
of a page that bareflow marks as a loss.
