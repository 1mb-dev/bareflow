// Markdown render of the IR. The JSON render is the IR itself (it is already a JSON tree).
// Markdown drops IR fields (anchors, section URLs, IDs); the IR is canonical but still lossy
// versus the source, since inline content is preserved as Markdown and extractor drops are
// only partially recoverable.

export function renderMarkdown(doc) {
  const out = [];
  const note = scopeNote(doc.scope);
  if (note) out.push(note, "");
  for (const s of doc.sections) renderSection(s, 1, out);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// One line saying what the document covers, from doc.scope. Silent for a lone page with no
// siblings to speak of.
function scopeNote(scope) {
  const { prev, next } = scope.siblings;
  if (prev.status === "absent" && next.status === "absent") return "";
  const what = scope.kind === "window" ? "a prev/next window onto the section, not the whole section" : "this page only";
  const projected = [prev, next].some((s) => s.projection?.mode === "headings+code") ? "; siblings show headings and code only" : "";
  return `> **Scope:** ${what} (prev: ${prev.status}, next: ${next.status}${projected})`;
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
    case "code": return `\`\`\`${b.lang || ""}\n${b.code}\n\`\`\``;
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
