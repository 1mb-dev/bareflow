// Parse HTML the way a browser would where linkedom's parser (htmlparser2) does not.
// Every read of a source page goes through here, so the pipeline and the truth scorer see the
// same tree.
import { parseHTML } from "linkedom";
import { Parser } from "htmlparser2";
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
    let at = anchor;
    for (const n of moved) { at.after(n); at = n; }
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
const element = (n, tag) => n.nodeType === 1 && n.tagName === tag;

function impliedBody(document) {
  let top = [...document.childNodes].filter((n) => n.nodeType !== 10);
  let root = top.find((n) => element(n, "HTML"));
  // Wrapped in the tree, not re-parsed with an <html> prefix: the prefix lands wherever a regex
  // thinks the markup starts (inside a title after `<!--->`), and a stray </html> then closes it.
  if (!root) {
    root = document.createElement("html");
    for (const n of top) root.append(n);
    document.append(root);
    top = [root];
  }
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
  // One node per call: a spread of a node list overflows the stack past ~124k arguments on Node's
  // main thread (more in a worker), so the same page would convert in one runtime only.
  const first = body.firstChild;
  for (const n of before) body.insertBefore(n, first);
  for (const n of [...after, ...top.slice(top.indexOf(root) + 1)]) body.append(n);
}

// A page bareflow will not convert, refused by name: the CLI and the worker map `code`, and
// convert() sets `host` to the host that answered.
export class Refused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// No HTML document: "blank" (no content, as parsed) or "not-html" (text, CSV, or JSON, which may
// carry markup in its strings); shape "json" when its first content opens with { or [.
export class NotHtml extends Refused {
  constructor(html, at) {
    const rest = html.slice(at);
    super(rest ? "not-html" : "blank", rest ? "the body is not an HTML document" : "the page is empty");
    this.shape = /^[[{]/.test(rest) ? "json" : "";
  }
}

// Limits (src/fetch-policy.js MAX_DEPTH, MAX_ELEMENTS), counted by htmlparser2 itself before
// linkedom builds a tree. linkedom builds from these same callbacks (an open tag descends, a close
// climbs whatever its name), so the counts are the tree's as parsed; the repairs after add at most
// html and body to its depth and html, head, and body to its count. Refusing mid-parse bounds
// htmlparser2's own costs: its open stack and its foreign-content stack grow by unshift (quadratic in
// depth, and in self-closed svg or math elements, which never pop), and every end tag searches the
// open stack. The options are linkedom's; htmlparser2 moves in lockstep with linkedom's range for it.
const PARSED = { lowerCaseAttributeNames: false, decodeEntities: true, xmlMode: false };

// Where the page's content starts, as htmlparser2 reads it: the first element, text past whitespace,
// or processing instruction other than a doctype; the length when there is none. An offset into the
// source, so a brace written as an entity is not a JSON body's brace.
function firstContent(html) {
  let at = html.length;
  const stop = {}, parser = new Parser({
    ontext(t) { if (t.trim()) { at = parser.startIndex + t.length - t.trimStart().length; throw stop; } },
    onopentagname() { at = parser.startIndex; throw stop; },
    onprocessinginstruction(name) { if (!name.toLowerCase().startsWith("!doctype")) { at = parser.startIndex; throw stop; } },
  }, PARSED);
  try { parser.write(html); parser.end(); } catch (e) { if (e !== stop) throw e; }
  return at;
}

// The deepest open element (html is 1) and the element count; with `caps`, refused past either.
export function parsedSize(html, caps = true) {
  let depth = 0, deepest = 0, elements = 0;
  const parser = new Parser({
    onopentag() {
      if (++elements > MAX_ELEMENTS && caps) throw new Refused("too-big", `the page has more than ${MAX_ELEMENTS} elements`);
      if (++depth > deepest) deepest = depth;
      if (depth > MAX_DEPTH && caps) throw new Refused("too-deep", `the page nests more than ${MAX_DEPTH} levels deep`);
    },
    onclosetag() { depth--; },
  }, PARSED);
  parser.write(html);
  parser.end();
  return { depth: deepest, elements };
}

export function parseHtml(html) {
  const at = firstContent(html);
  if (html[at] === "{" || html[at] === "[") throw new NotHtml(html, at);
  parsedSize(html);
  const window = parseHTML(html);
  if (!window.document.documentElement) throw new NotHtml(html, at);
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
