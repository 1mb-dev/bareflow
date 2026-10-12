# bareflow voice

For anyone writing a string bareflow shows: a web message, a CLI error, a label, a doc line.

## Two voices

The page's words are the page's. bareflow never rewrites, summarizes, or styles them.

bareflow's own words are few, plain, and about what happened. In the web view they are the mono
text: the header lines, the controls, the loss rail, the messages.

## Glossary: one word per thing

| Word | Means | Not |
|---|---|---|
| page | the docs page someone asked for | document, article, site |
| original | the page at its own address | source page |
| loss | a part of the page bareflow could not keep, named and numbered | error, issue, warning |
| flattened | the extraction kept almost none of the page's structure | broken, failed |
| fingerprint | the first 16 hex of the sha256 of the bytes read | hash, ID |
| snapshot | the bytes bareflow read, at `retrieved` | cache, copy |
| asserted | an address a person gave for pasted HTML; nothing was fetched | claimed, fake |
| markdown | the text bareflow writes; the view's raw mode | source (the header's `source` is the address asked) |
| this site | bareflow.1mb.dev | the web, the app, the tool |

## Message shape

What happened, then what to do. One or two sentences. Name the host. No apology, no "please",
no exclamation mark. A label or control is lowercase and says the action (`copy markdown`).

| Before | After |
|---|---|
| `credentials in <url>: the web fetches no URL with a user or password` | `<url> holds a user name or password. This site fetches no address with credentials: remove them and try again.` |
| `HTTP 403 from <host>; check the URL (bareflow does not retry)` | `<host> refused the request (HTTP 403). Check the address, or save the page and paste its HTML on the home page.` |
| `3 losses marked.` | `3 losses: parts of the page bareflow could not keep, listed beside it.` |

An instruction must work when it is read: no `npx bareflow` until the package is on npm.

## Banned

seamlessly, effortlessly, unlock, supercharge, simply, just, easily, magic, powerful, smart,
AI-powered, leverage, robust, cutting-edge, delve, oops, sorry, please, emoji, exclamation marks.
