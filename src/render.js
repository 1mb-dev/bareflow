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

export function renderMarkdown(doc) {
  const page = doc.sections[0];
  const out = [...header(doc, page), ""];
  for (const s of doc.sections) renderSection(s, 1, out);
  const n = doc.sections.reduce((k, s) => k + s.losses.length, 0);
  if (n) out.push(`## mdflow: ${n} loss${n === 1 ? "" : "es"} (fingerprint ${doc.source.fingerprint})`, "", ...lossNotes(doc));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// A URL as the WHATWG parser serializes it, or nothing: a header value is one line of URL.
function url(u) {
  try {
    const s = new URL(u).href;
    return /[\u0000- \u007f]/.test(s) ? null : s;
  } catch { return null; }
}

function header(doc, page) {
  const { source: src, generator: g } = doc;
  const losses = doc.sections.reduce((n, s) => n + s.losses.length, 0);
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

function renderSection(s, depth, out) {
  out.push(`${"#".repeat(Math.min(depth, 6))} ${s.title}`, "");
  // A blank line after every block: without it adjacent paragraphs merge, and a paragraph after
  // a list continues the list's last item.
  for (const b of s.blocks) out.push(renderBlock(b), "");
  for (const c of s.children) renderSection(c, depth + 1, out);
}

function renderBlock(b) {
  switch (b.type) {
    case "heading": return `${"#".repeat(b.level)} ${b.text}`;
    case "paragraph": return b.text;
    case "code": return fenced(b.code, b.lang || "");
    case "blockquote": return `> ${b.text}`;
    case "list": return b.items.map((it, i) => b.ordered ? `${i + 1}. ${it}` : `- ${it}`).join("\n");
    case "image": return `![${b.alt || ""}](${b.src})`;
    case "table": return renderTable(b);
    default: return "";
  }
}

function renderTable(t) {
  if (!t.headers.length) return "";
  const rows = [t.headers, ...t.rows].map((r) => `| ${r.map((c) => (c ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  const sep = `| ${t.headers.map(() => "---").join(" | ")} |`;
  return [rows[0], sep, ...rows.slice(1)].join("\n");
}
