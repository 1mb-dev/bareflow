// Convert Defuddle's content HTML into typed IR blocks, marking post-extraction losses
// explicitly. Extraction-level drops are handled by loss-audit.js against the source HTML.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

const LOSSLESS_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"]);

function inlineMarkdown(node, out = []) {
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) { out.push(child.textContent ?? ""); continue; } // text
    if (child.nodeType !== 1) continue; // skip non-elements
    const tag = child.tagName;
    if (LOSSLESS_TAGS.has(tag)) continue;
    switch (tag) {
      case "A": out.push(`[${textContent(child)}](${child.getAttribute("href") || ""})`); break;
      case "CODE": out.push(`\`${textContent(child)}\``); break;
      case "STRONG": case "B": out.push(`**${textContent(child)}**`); break;
      case "EM": case "I": out.push(`*${textContent(child)}*`); break;
      case "IMG": out.push(`![${child.getAttribute("alt") || ""}](${child.getAttribute("src") || ""})`); break;
      case "BR": out.push("\n"); break;
      case "PRE": out.push(`\`\`\`\n${codeText(child)}\n\`\`\``); break;
      default: inlineMarkdown(child, out);
    }
  }
  return out.join("");
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
  return { anchor, text: inlineMarkdown(el).trim() };
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
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map((c) => textContent(c));
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
    if (t) out.push(ir.paragraph(t));
    return;
  }
  if (tag === "BLOCKQUOTE") {
    const nested = pullCode(el);
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.blockquote(t));
    out.push(...nested);
    return;
  }
  if (tag === "UL" || tag === "OL") {
    const items = [];
    const nested = [];
    for (const li of [...el.children].filter((c) => c.tagName === "LI")) {
      nested.push(...pullCode(li));
      const text = inlineMarkdown(li).trim();
      if (text) items.push(text);
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
      if (t) out.push(ir.paragraph(t));
      return;
    }
    const cap = el.querySelector("figcaption");
    const t = cap ? inlineMarkdown(cap).trim() : "";
    if (t) out.push(ir.paragraph(t));
    return;
  }
  if (["IFRAME", "VIDEO", "AUDIO", "OBJECT", "EMBED"].includes(tag)) {
    out.push(lossOf(el, `${tag.toLowerCase()} embed not representable`));
    return;
  }
  // Math / interactive widgets often carry these classes.
  const cls = el.getAttribute("class") || "";
  if (/math|katex|interactive|playground|live-?example/i.test(cls)) {
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.paragraph(t)); else out.push(lossOf(el, "interactive or math content not representable"));
    return;
  }
  if (tag === "A") {
    const t = inlineMarkdown(el).trim();
    if (t) out.push(ir.paragraph(t));
    return;
  }
  // Div / section / article / header / footer: transparent containers, recurse.
  if (tag === "HR") return;
  if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "MAIN" || tag === "HEADER" || tag === "FOOTER" || tag === "ASIDE" || tag === "NAV" || tag === "SPAN") {
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const t = (c.textContent ?? "").replace(/\s+/g, " ").trim();
        if (t) out.push(ir.paragraph(t));
      } else if (c.nodeType === 1) {
        blockFor(c, out);
      }
    }
    return;
  }
  // Unknown block element: capture as paragraph if it has text, else recurse.
  const t = inlineMarkdown(el).trim();
  if (t) out.push(ir.paragraph(t));
}

export function contentToBlocks(contentHtml) {
  // Wrap in a container: Defuddle's content is a fragment, and linkedom parses a
  // fragment with its top element as documentElement, leaving document.body empty.
  const { document } = parseHTML(`<div id="__mdflow">${contentHtml || ""}</div>`);
  const root = document.querySelector("#__mdflow");
  const out = [];
  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(ir.paragraph(t));
    } else if (child.nodeType === 1) {
      blockFor(child, out);
    }
  }
  return out;
}
