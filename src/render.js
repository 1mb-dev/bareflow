// Markdown render of the IR. The JSON render is the IR itself (it is already a JSON tree).
// Markdown drops IR fields (anchors, section URLs, IDs); the IR is canonical but still lossy
// versus the source, since inline content is preserved as Markdown and extractor drops are
// only partially recoverable.
//
// Layout: a front-matter header (mdflow's fields only), the page, then one note per loss under
// a heading that carries the snapshot fingerprint. Page text never reaches a header line or a
// note's label line: header values are mdflow's own or re-serialized URLs, note labels come
// from the closed loss-source set, and every piece of page text in a note is fenced.

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
const REASON_IS_MDFLOW = new Set(["extract-flattened", "audit-scope-empty", "audit-truncated"]);
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
// spaces in their opaque path, so they never reach the header, whatever built the IR.
function url(u) {
  try { const p = new URL(u); return p.protocol === "http:" || p.protocol === "https:" ? p.href : null; } catch { return null; }
}

function header(doc, page, losses) {
  const { source: src, generator: g } = doc;
  const lines = ["---"];
  if (page.losses.some((l) => l.source === "extract-flattened")) lines.push("warning: extraction flattened this page; its structure below is unreliable, see the loss notes");
  lines.push(`mdflow: ${g.version} (${g.extractor} ${g.extractorVersion}, ${doc.schema})`);
  const from = url(src.url), final = url(src.finalUrl ?? src.url);
  if (from) lines.push(`source: ${from}`);
  if (final && final !== from) lines.push(`final: ${final}`);
  lines.push(`retrieved: ${src.retrievedAt}`, `fingerprint: ${src.fingerprint}`);
  for (const r of ["prev", "next"]) { const u = doc.scope[r] && url(doc.scope[r].url); if (u) lines.push(`${r}: ${u}`); }
  const up = doc.breadcrumbs.map((c) => url(c.url)).filter(Boolean);
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

// A fence one backtick longer than any run inside the text, so page text cannot close it.
function fenced(text, lang = "") {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const f = "`".repeat(Math.max(3, longest + 1));
  return `${f}${lang}\n${text}\n${f}`;
}

// Prose as Markdown: outside its code spans (a backtick run, text, a run of the same length), a
// run of three or more backticks or tildes is escaped, so page text about Markdown can neither
// sit a fence mid-line nor open one at a line start over the rest of the page. The IR keeps the
// text as the page had it; only this render escapes.
function prose(t) {
  const out = [];
  let i = 0;
  const span = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (let m; (m = span.exec(t)); i = span.lastIndex) out.push(escapeRuns(t.slice(i, m.index)), m[0]);
  out.push(escapeRuns(t.slice(i)));
  return out.join("");
}
const escapeRuns = (t) => t.replace(/`{3,}|~{3,}/g, (m) => m.replace(/./g, "\\$&"));

function renderSection(s, depth, out) {
  out.push(`${"#".repeat(Math.min(depth, 6))} ${prose(s.title)}`, "");
  // A blank line after every block: without it adjacent paragraphs merge, and a paragraph after
  // a list continues the list's last item.
  for (const b of s.blocks) { const r = renderBlock(b); if (r) out.push(r, ""); }
  for (const c of s.children) renderSection(c, depth + 1, out);
}

function renderBlock(b) {
  switch (b.type) {
    case "heading": return `${"#".repeat(b.level)} ${prose(b.text)}`;
    case "paragraph": return prose(b.text);
    case "code": return fenced(b.code, b.lang || "");
    case "blockquote": return `> ${prose(b.text)}`;
    case "list": return b.items.map((it, i) => b.ordered ? `${i + 1}. ${prose(it)}` : `- ${prose(it)}`).join("\n");
    case "image": return `![${b.alt || ""}](${b.src})`;
    case "table": return renderTable(b);
    default: return "";
  }
}

function renderTable(t) {
  if (!t.headers.length) return "";
  const rows = [t.headers, ...t.rows].map((r) => `| ${r.map((c) => prose(c ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  const sep = `| ${t.headers.map(() => "---").join(" | ")} |`;
  return [rows[0], sep, ...rows.slice(1)].join("\n");
}
