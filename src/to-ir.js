// Convert Defuddle's content HTML into typed IR blocks, marking post-extraction losses
// explicitly. Extraction-level drops are handled by loss-audit.js against the source HTML.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";
import { innerMain } from "./html.js";
import { codeSpan, dest, escapeHeadingEnd, escapeStart, escapeText } from "./md.js";

const LOSSLESS_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);
// Math / interactive widgets often carry these classes.
const MATH_CLASS = /math|katex|interactive|playground|live-?example/i;

// A link or image target mdflow will write: http(s), mailto, or relative; an empty one or any
// other scheme (javascript:, data:) is dropped and only the text kept.
const target = (u) => (!u.trim() || (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|mailto):/i.test(u)) ? null : dest(u));
// HTML whitespace collapses in text; <br> is the only line break the IR keeps.
const collapse = (t) => t.replace(/[\t\n\f\r ]+/g, " ");

function inlineMarkdown(node, out = []) {
  // Adjacent text nodes are one run: the parser splits text at entities ("Promise", "<",
  // "string"), and escaping each piece alone misses what the next piece makes of it.
  let text = "";
  const flush = () => { if (text) out.push(escapeText(collapse(text))); text = ""; };
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) { text += child.textContent ?? ""; continue; }
    flush();
    if (child.nodeType !== 1) continue; // skip non-elements
    const tag = child.tagName;
    if (LOSSLESS_TAGS.has(tag)) continue;
    switch (tag) {
      case "A": { const t = escapeText(textContent(child)), h = target(child.getAttribute("href") || ""); out.push(h === null ? t : `[${t}](${h})`); break; }
      case "CODE": out.push(codeSpan(textContent(child))); break;
      case "STRONG": case "B": out.push(`**${escapeText(textContent(child))}**`); break;
      case "EM": case "I": out.push(`*${escapeText(textContent(child))}*`); break;
      case "IMG": { const a = escapeText(collapse(child.getAttribute("alt") || "").trim()), s = target(child.getAttribute("src") || ""); out.push(s === null ? a : `![${a}](${s})`); break; }
      case "BR": out.push("\n"); break;
      // A <pre> inside a heading or widget has no block to become: a sized code span, so prose
      // never carries a fence.
      case "PRE": out.push(codeSpan(codeText(child).replace(/\s+/g, " ").trim())); break;
      default: inlineMarkdown(child, out);
    }
  }
  flush();
  return out.join("").replace(/ *\n */g, "\n");
}

function textContent(node) {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

// Code keeps its line breaks and indentation (Python, YAML); only leading blank lines and
// trailing whitespace go.
function codeText(pre) {
  return (pre.textContent ?? "").replace(/^\s*\n/, "").replace(/\s+$/, "");
}

// A heading's permalink anchor: either its id, or an <a href="#..."> child. Strip it from text.
function headingParts(el) {
  let anchor = el.getAttribute("id") || "";
  const link = el.querySelector('a[href^="#"]');
  if (link) {
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) anchor = href.slice(1);
    link.remove();
  }
  return { anchor, text: escapeHeadingEnd(escapeStart(inlineMarkdown(el).trim())) };
}

function detectLang(pre) {
  const code = pre.querySelector("code");
  if (!code) return undefined;
  const cls = (code.getAttribute("class") || "") + " " + (pre.getAttribute("class") || "");
  const m = cls.match(/(?:language|lang)-([\w+-]+)/i);
  return m ? m[1] : undefined;
}

// Pull nested <pre> blocks out of a container, emit them as code blocks, and remove them
// so the container's inline text no longer inlines them. Returns the code blocks.
function pullCode(el) {
  const codes = [];
  for (const pre of [...el.querySelectorAll("pre")]) {
    codes.push(ir.code(codeText(pre), detectLang(pre)));
    pre.remove();
  }
  return codes;
}

function tableOf(tbl) {
  const headers = [];
  const rows = [];
  for (const tr of tbl.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => escapeText(textContent(c), { cell: true }));
    if (!cells.length) continue;
    if (tr.querySelector("th") && headers.length === 0) headers.push(...cells);
    else rows.push(cells);
  }
  // Headerless tables: promote first row.
  if (headers.length === 0 && rows.length) { headers.push(...rows.shift()); }
  return { headers, rows };
}

function lossOf(el, reason) {
  return ir.loss(reason, "extract-unrepresentable", el.outerHTML.slice(0, 120).replace(/\s+/g, " "));
}

function blockFor(el, out) {
  const tag = el.tagName;
  if (LOSSLESS_TAGS.has(tag)) return;

  if (/^H[1-6]$/.test(tag)) {
    const { anchor, text } = headingParts(el);
    if (text) out.push(ir.heading(text, Number(tag[1]), anchor));
    return;
  }
  if (tag === "PRE") {
    out.push(ir.code(codeText(el), detectLang(el)));
    return;
  }
  if (tag === "P") {
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.paragraph(escapeStart(t)));
    return;
  }
  if (tag === "BLOCKQUOTE") {
    const nested = pullCode(el);
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.blockquote(escapeStart(t)));
    out.push(...nested);
    return;
  }
  if (tag === "UL" || tag === "OL") {
    const items = [];
    const nested = [];
    for (const li of [...el.children].filter((c) => c.tagName === "LI")) {
      nested.push(...pullCode(li));
      const text = inlineMarkdown(li).trim();
      if (text) items.push(escapeStart(text));
    }
    if (items.length) out.push(ir.list(tag === "OL", items));
    out.push(...nested);
    return;
  }
  if (tag === "TABLE") {
    const { headers, rows } = tableOf(el);
    if (headers.length || rows.length) out.push(ir.table(headers, rows));
    return;
  }
  if (tag === "IMG") {
    out.push(ir.image(el.getAttribute("src") || "", el.getAttribute("alt") || ""));
    return;
  }
  if (tag === "FIGURE") {
    const nested = pullCode(el);
    const img = el.querySelector("img");
    if (img) out.push(ir.image(img.getAttribute("src") || "", img.getAttribute("alt") || ""));
    out.push(...nested);
    if (!nested.length && !img) {
      const t = inlineMarkdown(el).trim();
      if (t) out.push(ir.paragraph(escapeStart(t)));
      return;
    }
    const cap = el.querySelector("figcaption");
    const t = cap ? inlineMarkdown(cap).trim() : "";
    if (t) out.push(ir.paragraph(escapeStart(t)));
    return;
  }
  if (["IFRAME", "VIDEO", "AUDIO", "OBJECT", "EMBED"].includes(tag)) {
    out.push(lossOf(el, `${tag.toLowerCase()} embed not representable`));
    return;
  }
    const cls = el.getAttribute("class") || "";
  if (MATH_CLASS.test(cls)) {
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.paragraph(escapeStart(t))); else out.push(lossOf(el, "interactive or math content not representable"));
    return;
  }
  if (tag === "A") {
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.paragraph(escapeStart(t)));
    return;
  }
  // Div / section / article / header / footer: transparent containers, recurse. Defuddle can
  // return its content wrapped in <body> (tailwindcss.com); as an unknown element it would
  // flatten the whole page into one paragraph.
  if (tag === "HR") return;
  if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "MAIN" || tag === "HEADER" || tag === "FOOTER" || tag === "ASIDE" || tag === "NAV" || tag === "SPAN" || tag === "BODY") {
    childBlocks(el, out);
    return;
  }
  // Unknown element (dl, dd, details): a container when it holds blocks, so a nested <pre>
  // stays a code block instead of inline fences in prose; else one paragraph.
  if (el.querySelector(BLOCK_INSIDE)) { childBlocks(el, out); return; }
  const t = inlineMarkdown(el).trim();
  if (t) out.push(ir.paragraph(escapeStart(t)));
}

const INLINE_TAGS = new Set(["A", "ABBR", "B", "BR", "CITE", "CODE", "DEL", "DFN", "EM", "I", "INS", "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR"]);
const BLOCK_INSIDE = "p, div, pre, table, ul, ol, blockquote, figure, h1, h2, h3, h4, h5, h6";

function isInline(node) {
  if (node.nodeType === 3) return true;
  if (node.nodeType !== 1 || !INLINE_TAGS.has(node.tagName)) return false;
  return !MATH_CLASS.test(node.getAttribute("class") || "") && !node.querySelector(BLOCK_INSIDE);
}

// A container's children as blocks. Each run of text and inline elements is one paragraph: a
// sentence with inline <code> in a bare <div> (k8s callouts) must not split per node.
function childBlocks(el, out) {
  let run = [];
  const flush = () => {
    const t = inlineMarkdown({ childNodes: run }).replace(/\s+/g, " ").trim();
    if (t) out.push(ir.paragraph(escapeStart(t)));
    run = [];
  };
  for (const c of el.childNodes) {
    if (isInline(c)) { run.push(c); continue; }
    flush();
    if (c.nodeType === 1) blockFor(c, out);
  }
  flush();
}

export function contentToBlocks(contentHtml) {
  // Wrap in a container: Defuddle's content is a fragment, and linkedom parses a
  // fragment with its top element as documentElement, leaving document.body empty.
  const { document } = parseHTML(`<div id="__mdflow">${contentHtml || ""}</div>`);
  const root = document.querySelector("#__mdflow");
  const out = [];
  childBlocks(innerMain(root) ?? root, out);
  return out;
}
