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
// <html> the first element becomes the root, with no <body> the content sits beside the head, and
// text before the doctype sits beside the root, where the extractor and the loss audit never look.
// So the page's html element (one is added when the source has none) takes every other top-level
// node, and whatever sits beside head and body moves where a browser puts it: metadata before any
// content into head, the rest into body, in document order. head and body are found among the
// root's children, never through document.head/body: linkedom's getters create them.
const METADATA = new Set(["TITLE", "META", "LINK", "BASE", "STYLE"]);
const HEADISH = new Set([...METADATA, "SCRIPT", "NOSCRIPT", "TEMPLATE"]);
const LEAD = /^(?:\s*(?:<!--[\s\S]*?-->|<!doctype[^>]*>))*\s*/i;
const element = (n, tag) => n.nodeType === 1 && n.tagName === tag;

function impliedBody(document) {
  const top = [...document.childNodes].filter((n) => n.nodeType !== 10);
  const root = top.find((n) => element(n, "HTML"));
  const kids = [...root.childNodes];
  let head = kids.find((n) => element(n, "HEAD")), body = kids.find((n) => element(n, "BODY"));
  if (!head) root.prepend((head = document.createElement("head")));
  const content = (n) => (n.nodeType === 1 && !HEADISH.has(n.tagName)) || (n.nodeType === 3 && n.textContent.trim() !== "");
  const at = [...head.childNodes].findIndex(content), tail = at < 0 ? [] : [...head.childNodes].slice(at);
  const pre = top.slice(0, top.indexOf(root)), before = [...pre, ...tail], after = [];
  let seen = before.some(content), past = false;
  for (const n of kids) {
    if (n === head) continue;
    if (n === body) { past = true; continue; }
    if (past) after.push(n);
    else if (!seen && n.nodeType === 1 && METADATA.has(n.tagName)) head.append(n);
    else { seen ||= content(n); before.push(n); }
  }
  if (!body) root.append((body = document.createElement("body")));
  body.prepend(...before);
  body.append(...after, ...top.slice(top.indexOf(root) + 1));
}

// A page bareflow will not convert, refused by name: the CLI and the worker map `code`, and
// convert() sets `host` to the host that answered.
export class Refused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// No HTML document: "blank" (nothing past whitespace, comments, and a doctype) or "not-html"
// (text, CSV, or JSON, which may carry markup in its strings); shape "json" when it opens with { or [.
export class NotHtml extends Refused {
  constructor(html) {
    const rest = html.slice(html.match(LEAD)[0].length);
    super(rest ? "not-html" : "blank", rest ? "the body is not an HTML document" : "the body is empty");
    this.shape = /^[[{]/.test(rest) ? "json" : "";
  }
}

// Extraction time grows faster than linearly with nesting depth and with element count (Defuddle
// over linkedom; 2,000 levels took 196 s), and linkedom's own parse is quadratic in depth (100,000
// levels, 0.5 MB, 4.7 s). The frozen pages reach depth 28 and 6,268 elements. A linear scan of the
// source refuses depth before linkedom parses; the parsed tree is then measured exactly. Both
// iterate: a recursive walk would overflow the stack on the inputs it exists to refuse.
export const MAX_DEPTH = 256, MAX_ELEMENTS = 50000;
const SCAN_DEPTH = 4096;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// An open tag of these closes an open one of the same group, as a browser does with a missing end tag.
const SIBLING = { p: "p", li: "li", dt: "d", dd: "d", option: "option", tr: "tr", td: "cell", th: "cell" };
const RAW = /^(?:script|style|textarea|title|xmp|noscript|template)$/;

function scanDepth(html) {
  const open = [];
  const tag = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
  for (let m; (m = tag.exec(html)); ) {
    if (!m[2]) continue;
    const name = m[2].toLowerCase();
    if (m[1]) { const at = open.lastIndexOf(name); if (at >= 0) open.length = at; continue; }
    if (VOID.has(name) || m[3]) continue;
    if (SIBLING[name] && SIBLING[open.at(-1)] === SIBLING[name]) open.pop();
    if (RAW.test(name)) { const close = html.toLowerCase().indexOf(`</${name}`, tag.lastIndex); tag.lastIndex = close < 0 ? html.length : close; continue; }
    open.push(name);
    if (open.length > SCAN_DEPTH) return open.length;
  }
  return open.length;
}

function measure(root) {
  let elements = 0, deepest = 0;
  for (const stack = [[root, 1]]; stack.length; ) {
    const [n, d] = stack.pop();
    elements++;
    if (d > deepest) deepest = d;
    if (d > MAX_DEPTH || elements > MAX_ELEMENTS) break;
    for (let c = n.firstElementChild; c; c = c.nextElementSibling) stack.push([c, d + 1]);
  }
  return { elements, deepest };
}

export function parseHtml(html) {
  const rest = html.slice(html.match(LEAD)[0].length);
  if (/^[[{]/.test(rest)) throw new NotHtml(html);
  if (scanDepth(html) > SCAN_DEPTH) throw new Refused("too-deep", `the page nests more than ${MAX_DEPTH} levels deep`);
  let window = parseHTML(html);
  if (!window.document.documentElement) throw new NotHtml(html);
  if (![...window.document.childNodes].some((n) => element(n, "HTML"))) window = parseHTML(`${html.slice(0, html.length - rest.length)}<html>${rest}`);
  impliedBody(window.document);
  const { elements, deepest } = measure(window.document.documentElement);
  if (deepest > MAX_DEPTH) throw new Refused("too-deep", `the page nests more than ${MAX_DEPTH} levels deep`);
  if (elements > MAX_ELEMENTS) throw new Refused("too-big", `the page has more than ${MAX_ELEMENTS} elements`);
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
