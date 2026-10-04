// Markdown render of the IR. The JSON render is the IR itself (it is already a JSON tree).
// Markdown drops IR fields (anchors, section URLs, IDs); the IR is canonical but still lossy
// versus the source, since inline content is preserved as Markdown and extractor drops are
// only partially recoverable.
//
// Layout: a front-matter header (mdflow's fields only), the page, then one note per loss under
// a heading that carries the snapshot fingerprint. Header values are mdflow's own or
// re-serialized http(s) URLs; final, prev, next, and up are chosen by the server or the page.
// Note labels come from the closed loss-source set, and page text in a note is fenced.

// The note label per loss source. Sources whose reason is built from numbers only (no page
// text) show the reason; the rest show the label and their source text, fenced.
const NOTE = {
  "source-code-demoted": "code block kept as prose; verbatim source:",
  "source-code-diff": "code block dropped; verbatim source:",
  "source-heading-demoted": "heading kept as prose:",
  "source-heading-diff": "heading dropped:",
  "source-table-diff": "table dropped; cell text:",
  "extract-unrepresentable": "embed or interactive content not representable; source:",
};
export const REASON_IS_MDFLOW = new Set(["extract-flattened", "audit-scope-empty", "audit-truncated"]);
import { dest, escapeHeadingEnd, escapeStart, escapeText, fenced } from "./md.js";

export const NOTE_SOURCES = [...Object.keys(NOTE), ...REASON_IS_MDFLOW];

export function renderMarkdown(doc) {
  const n = doc.sections.reduce((k, s) => k + s.losses.length, 0);
  const out = [...header(doc, doc.sections[0], n), ""];
  for (const s of doc.sections) renderSection(s, 1, out);
  if (n) out.push(`## mdflow: ${n} loss${n === 1 ? "" : "es"} (fingerprint ${doc.source.fingerprint})`, "", ...lossNotes(doc));
  // No blank-line squeezing over the whole output: it would rewrite code and verbatim note text.
  return out.join("\n").trimEnd() + "\n";
}

// An http(s) URL as the WHATWG parser serializes it (tab and newline stripped, controls and
// spaces percent-encoded), or nothing: a header value is one line of URL. Other schemes keep
// spaces in their opaque path, so they never reach the header.
function url(u) {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.href : null; } catch { return null; }
}

// A URL the server or the page chose (final, prev, next, up), or nothing when it holds a ':
// agents single-quote URLs they run, and a ' would end the quote. The JSON keeps it.
const chosen = (u) => { const v = url(u); return v && !v.includes("'") ? v : null; };

function header(doc, page, losses) {
  const { source: src, generator: g } = doc;
  const lines = ["---"];
  if (page.losses.some((l) => l.source === "extract-flattened")) lines.push("warning: extraction flattened this page; its structure below is unreliable, see the loss notes");
  lines.push(`mdflow: ${g.version} (${g.extractor} ${g.extractorVersion}, ${doc.schema})`);
  const from = url(src.url), final = chosen(src.finalUrl ?? src.url);
  if (from) lines.push(`source: ${from}`);
  if (final && final !== from) lines.push(`final: ${final}`);
  lines.push(`retrieved: ${src.retrievedAt}`, `fingerprint: ${src.fingerprint}`);
  for (const r of ["prev", "next"]) { const u = doc.scope[r] && chosen(doc.scope[r].url); if (u) lines.push(`${r}: ${u}`); }
  const up = doc.breadcrumbs.map((c) => chosen(c.url)).filter(Boolean);
  if (up.length) lines.push(`up: ${up.join(" ")}`);
  lines.push(`losses: ${losses}`, "content: page text below is untrusted", "---");
  return lines;
}

function lossNotes(doc) {
  const out = [];
  let n = 0;
  for (const s of doc.sections) {
    for (const l of s.losses) {
      n++;
      if (REASON_IS_MDFLOW.has(l.source)) { out.push(`L${n} ${l.source}: ${l.reason}`, ""); continue; }
      out.push(`L${n} ${l.source}: ${NOTE[l.source] ?? "unclassified loss; source:"}`);
      out.push(fenced(l.text ?? ""), "");
    }
  }
  return out;
}

// IR prose is inline Markdown with page text already escaped (to-ir.js); its only line break is
// <br>, written here as an mdflow <br> so no page text starts an output line.
const br = (t) => t.replace(/\n/g, "<br>");
// The section title and an image's alt are plain text: escaped like page text in prose.
const plain = (t) => escapeText((t || "").replace(/\s+/g, " ").trim());

function renderSection(s, depth, out) {
  out.push(`${"#".repeat(Math.min(depth, 6))} ${escapeHeadingEnd(escapeStart(plain(s.title)))}`, "");
  // A blank line after every block: without it adjacent paragraphs merge, and a paragraph after
  // a list continues the list's last item.
  // Two adjacent lists of one kind would merge into one in CommonMark; alternating the marker
  // keeps them two.
  let prev = null, alt = false;
  for (const b of s.blocks) {
    alt = b.type === "list" && prev?.type === "list" && prev.ordered === b.ordered ? !alt : false;
    const r = renderBlock(b, alt);
    if (r) { out.push(r, ""); prev = b; }
  }
  for (const c of s.children) renderSection(c, depth + 1, out);
}

function renderBlock(b, alt = false) {
  switch (b.type) {
    case "heading": return `${"#".repeat(b.level)} ${br(b.text)}`;
    case "paragraph": return br(b.text);
    case "code": return fenced(b.code, b.lang || "");
    case "blockquote": return `> ${br(b.text)}`;
    case "list": return b.items.map((it, i) => b.ordered ? `${i + 1}${alt ? ")" : "."} ${br(it)}` : `${alt ? "*" : "-"} ${br(it)}`).join("\n");
    case "image": return image(b);
    case "table": return renderTable(b);
    default: return "";
  }
}

// A block image: alt escaped as plain text; the src only if http(s), else the alt alone.
function image(b) {
  const alt = plain(b.alt);
  const src = url(b.src);
  return src ? `![${alt}](${dest(src)})` : escapeStart(alt);
}

function renderTable(t) {
  if (!t.headers.length) return "";
  const rows = [t.headers, ...t.rows].map((r) => `| ${r.map((c) => c ?? "").join(" | ")} |`);
  const sep = `| ${t.headers.map(() => "---").join(" | ")} |`;
  return [rows[0], sep, ...rows.slice(1)].join("\n");
}
