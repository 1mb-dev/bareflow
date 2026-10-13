// Parse HTML the way a browser would where linkedom's parser (htmlparser2) does not.
// Every read of a source page goes through here, so the pipeline and the truth scorer see the
// same tree.
import { parseHTML } from "linkedom";

const SECTION = new Set(["THEAD", "TBODY", "TFOOT"]);

// A table written with optional end tags (`<th>Description<tbody><tr>...`) leaves the cell open,
// so htmlparser2 nests the next row or section inside it. The spec closes the cell (and row)
// instead: move the stray row or section, and everything after it, out beside its ancestor.
function repairTables(document) {
  for (const cell of document.querySelectorAll("th, td")) {
    const stray = [...cell.children].find((c) => c.tagName === "TR" || SECTION.has(c.tagName));
    if (!stray) continue;
    const row = cell.parentElement;
    if (row?.tagName !== "TR") continue;
    const anchor = SECTION.has(stray.tagName) && SECTION.has(row.parentElement?.tagName) ? row.parentElement : row;
    const moved = [];
    for (let n = stray; n; n = n.nextSibling) moved.push(n);
    anchor.after(...moved);
  }
}

// The html, head, and body tags are optional; a browser implies them. htmlparser2 does not: with no
// <html> the first element becomes the root, and with no <body> the content sits beside an empty
// body, where the extractor and the loss audit never look. So a source whose root is not html is
// parsed once more with one, and whatever sits beside head and body moves where a browser puts
// it: metadata before any content into head, the rest into body, in document order.
const METADATA = new Set(["TITLE", "META", "LINK", "BASE", "STYLE"]);
const LEAD = /^﻿?\s*(?:(?:<!--[\s\S]*?-->|<!doctype[^>]*>)\s*)*/i;

function impliedBody({ documentElement: root, head, body }) {
  if (root.tagName !== "HTML" || !head || !body) return;
  // A body element with nothing in it is the parser's own, placed ahead of the content it left out.
  const content = [...head.childNodes].findIndex((n) => n.nodeType === 1 && !METADATA.has(n.tagName) && !["SCRIPT", "NOSCRIPT", "TEMPLATE"].includes(n.tagName));
  const before = content < 0 ? [] : [...head.childNodes].slice(content);
  let past = false;
  for (const n of [...root.childNodes]) {
    if (n === head) continue;
    if (n === body) { past = body.hasChildNodes(); continue; }
    if (past) body.append(n);
    else if (!before.length && n.nodeType === 1 && METADATA.has(n.tagName)) head.append(n);
    else before.push(n);
  }
  const doc = root.ownerDocument.childNodes;
  body.append(...[...doc].slice([...doc].indexOf(root) + 1));
  body.prepend(...before);
}

// Raised when the body is no HTML document at all: code "blank" (nothing but whitespace) or
// "not-html" (text, JSON, CSV: htmlparser2 builds no root). shape "json" when it opens with { or [.
export class NotHtml extends Error {
  constructor(html) {
    const text = html.replace(/^﻿/, "").trim();
    super(text ? "the body is not an HTML document" : "the body is empty");
    this.code = text ? "not-html" : "blank";
    this.shape = /^[[{]/.test(text) ? "json" : "";
  }
}

export function parseHtml(html) {
  let window = parseHTML(html);
  if (!window.document.documentElement) throw new NotHtml(html);
  if (window.document.documentElement.tagName !== "HTML") {
    const lead = html.match(LEAD)[0];
    window = parseHTML(`${lead}<html>${html.slice(lead.length)}`);
  }
  impliedBody(window.document);
  repairTables(window.document);
  return window;
}

// The page's own main landmark when it declares them nested (SQLAlchemy: a <main> holding the
// sidebar and a div[role=main]): the innermost is the content, the rest chrome by the page's
// own markup. Null unless every landmark sits on one chain, so sibling mains decide nothing.
export function innerMain(root) {
  const marks = [...root.querySelectorAll("main, [role='main']")];
  if (marks.length < 2) return null;
  for (let i = 1; i < marks.length; i++) if (!marks[i - 1].contains(marks[i])) return null;
  return marks.at(-1);
}
