// Parse HTML the way a browser would where linkedom's parser (htmlparser2) does not.
// Every read of a source page goes through here, so the pipeline and the truth scorer see the
// same tree.
import { parseHTML } from "linkedom";
import { MAX_DEPTH, MAX_ELEMENTS } from "./fetch-policy.js";

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

// Limits (src/fetch-policy.js MAX_DEPTH, MAX_ELEMENTS). linkedom's own parse is quadratic in depth
// (100,000 levels, 0.5 MB: 4.7 s), so a linear scan of the source refuses extreme depth before it
// parses; the parsed tree is then measured exactly. Both iterate: a recursive walk would overflow
// the stack on the inputs it exists to refuse.
// 4x the tree's cap and 36x the frozen pages' deepest scan (28): htmlparser2 checks each end tag
// against its open stack, so the open depth it is handed bounds the cost of stray end tags too.
const SCAN_DEPTH = 1024;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
// Not counted: the elements htmlparser2 closes when the next one opens (measured: repeated 3,000
// times each, linkedom builds them flat), and the raw-text elements it does not parse inside. The
// rest of the optional-end set (html, head, body, thead, tfoot, colgroup, caption, rb, rtc) and
// noscript, template, plaintext nest in linkedom, so they count. A list here is a claim about the
// parser: verify checks each entry against linkedom.
export const SCAN_FLAT = new Set(["p", "li", "dt", "dd", "option", "optgroup", "tr", "td", "th", "tbody", "rt", "rp"]);
export const SCAN_RAW = new Set(["script", "style", "textarea", "title", "xmp"]);
const NAME = /[a-zA-Z][\w:-]*/y;
// htmlparser2 honors "/>" only in foreign content, kept as its own stack: svg and math push true, an
// HTML integration point pushes false, and an end tag of any of them pops one entry whether or not
// that element is open (measured: <div/> nests inside <svg><foreignObject>, <svg><desc>, and after a
// stray </desc> in an svg; math's <mi/> nests). A self-closing svg or math pops at once.
const FOREIGN = new Set(["svg", "math"]), INTEGRATION = new Set(["mi", "mo", "mn", "ms", "mtext", "annotation-xml", "foreignobject", "desc", "title"]);

// The depth of counted elements in the source, in one pass: each "<" is read once, a quoted
// attribute value is skipped whole (it may hold "<" or ">"), and raw text is skipped to its end tag.
// An end tag searches the open list only when its name is open (counted per name), and the search
// stops at what it then removes, so stray end tags cost nothing and the whole scan stays linear.
function scanDepth(html) {
  const lower = html.toLowerCase(), open = [], foreign = [], count = new Map(), n = html.length;
  const context = (name) => FOREIGN.has(name) || INTEGRATION.has(name);
  for (let i = lower.indexOf("<"); i >= 0 && i < n; i = lower.indexOf("<", i)) {
    if (lower.startsWith("<!--", i)) { const end = lower.indexOf("-->", i + 4); if (end < 0) break; i = end + 3; continue; }
    const close = lower[i + 1] === "/";
    NAME.lastIndex = i + (close ? 2 : 1);
    const name = NAME.exec(lower)?.[0];
    if (!name) { i++; continue; }
    let j = NAME.lastIndex;
    // A quote opens a value only after "=" (whitespace between allowed); elsewhere it is text.
    for (let eq = false; j < n && lower[j] !== ">"; j++) {
      const c = lower[j];
      if ((c === '"' || c === "'") && eq) { j = lower.indexOf(c, j + 1); if (j < 0) return open.length; eq = false; continue; }
      if (c === "=") eq = true;
      else if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r" && c !== "\f") eq = false;
    }
    if (j >= n) break;
    i = j + 1;
    if (close) {
      if (context(name)) foreign.pop();
      if (!count.get(name)) continue;
      for (let at = open.length - 1, top; at >= 0; at--) { top = open.pop(); count.set(top, count.get(top) - 1); if (top === name) break; }
      continue;
    }
    if (SCAN_RAW.has(name)) { const end = lower.indexOf(`</${name}`, i); if (end < 0) break; i = end; continue; }
    if (context(name)) foreign.push(FOREIGN.has(name));
    const selfClosed = lower[j - 1] === "/" && foreign.at(-1) === true;
    if (selfClosed && context(name)) foreign.pop();
    if (VOID.has(name) || SCAN_FLAT.has(name) || selfClosed) continue;
    open.push(name);
    count.set(name, (count.get(name) ?? 0) + 1);
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
  if (scanDepth(html) > SCAN_DEPTH) throw Object.assign(new Refused("too-deep", `the page nests more than ${MAX_DEPTH} levels deep`), { scanned: true });
  let window = parseHTML(html);
  if (!window.document.documentElement) throw new NotHtml(html);
  if (![...window.document.childNodes].some((n) => element(n, "HTML"))) window = parseHTML(`${html.slice(0, html.length - rest.length)}<html>${rest}`);
  impliedBody(window.document);
  repairTables(window.document);
  const { elements, deepest } = measure(window.document.documentElement);
  if (deepest > MAX_DEPTH) throw new Refused("too-deep", `the page nests more than ${MAX_DEPTH} levels deep`);
  if (elements > MAX_ELEMENTS) throw new Refused("too-big", `the page has more than ${MAX_ELEMENTS} elements`);
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
