// Source-loss audit: diff load-bearing blocks (headings, code, tables) in the raw HTML
// against the extracted IR and emit a loss block per drop. Multiset identity, so duplicate
// blocks are counted and a dropped copy is still flagged. Chrome is excluded by a denylist;
// the audit scans body minus that denylist and is a conservative heuristic, not a content
// detector.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

const SKIP =
  "nav, aside, footer, [role='navigation'], .sidebar, .toc, #toc, .sphinxsidebar, " +
  "[class*='footer'], [class*='feedback'], [id*='footer'], [id*='feedback']";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const aggressive = (s) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Strip a leading section number ("3.1.", "3.1.1.") so source and IR headings compare even
// when one side drops the numbering.
function headingKey(t) {
  return norm(t).replace(/^\d+(\.\d+)*\.?\s+/, "").toLowerCase();
}
const codeKey = (s) => norm(s);
const tableKey = (cells) => norm(cells.join(" "));
const cellNorm = (c) => aggressive(norm(c).replace(/#.*$/, ""));

function sourceBlocks(html) {
  const { document } = parseHTML(html);
  const root = document.body;

  const headings = [], codes = [], tables = [];
  for (const h of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (h.closest(SKIP)) continue;
    const text = norm(h.textContent).replace(/\s*¶\s*$/, "");
    if (text) headings.push({ level: Number(h.tagName[1]), text });
  }
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.closest(SKIP)) continue;
    const t = norm(pre.textContent);
    if (t) codes.push(t);
  }
  for (const tbl of root.querySelectorAll("table")) {
    if (tbl.closest(SKIP)) continue;
    const cells = [...tbl.querySelectorAll("th,td")].map((c) => norm(c.textContent));
    if (cells.length) tables.push(cells);
  }
  return { headings, codes, tables };
}

// Multiset counts of IR blocks keyed by identity, plus the IR's full normalized text.
function irCounts(blocks) {
  const headings = new Map(), codes = new Map(), tables = new Map();
  const text = [];
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const b of blocks) {
    if (b.type === "heading") { bump(headings, headingKey(b.text)); text.push(b.text); }
    else if (b.type === "code") { bump(codes, codeKey(b.code)); text.push(b.code); }
    else if (b.type === "table") { bump(tables, tableKey([...b.headers, ...b.rows.flat()])); text.push(...b.headers, ...b.rows.flat()); }
    else if (b.type === "list") text.push(...b.items);
    else if (b.type === "paragraph" || b.type === "blockquote") text.push(b.text);
  }
  return { headings, codes, tables, fullText: aggressive(text.join(" ")) };
}

function take(map, key) {
  const c = map.get(key) || 0;
  if (c > 0) { map.set(key, c - 1); return true; }
  return false;
}

// A source table survived if it matches an IR table, or most of its data cells appear in
// the IR's text (Defuddle re-renders some tables as lists or prose; that is re-shaping, not
// a drop). Cell text is normalized (fragment and symbol stripped) before matching.
function tableSurvived(cells, tables, fullText) {
  if (take(tables, tableKey(cells))) return true;
  const data = cells.slice(1).map(cellNorm).filter(Boolean); // skip the header row
  if (!data.length) return true;
  const hits = data.filter((c) => fullText.includes(c));
  return hits.length / data.length >= 0.6;
}

export function auditSourceLoss(html, blocks, title = "") {
  const src = sourceBlocks(html);
  const irc = irCounts(blocks);
  const titleKey = headingKey(title);
  const losses = [];

  for (const h of src.headings) {
    if (headingKey(h.text) === titleKey) continue; // the h1 that became document.title is not lost
    if (!take(irc.headings, headingKey(h.text))) {
      losses.push(ir.loss(`source heading not extracted (h${h.level}): ${h.text}`, "source-heading-diff"));
    }
  }
  for (const code of src.codes) {
    if (!take(irc.codes, codeKey(code))) {
      losses.push(ir.loss(`source code block not extracted: ${code.slice(0, 80)}`, "source-code-diff"));
    }
  }
  for (const cells of src.tables) {
    if (!tableSurvived(cells, irc.tables, irc.fullText)) {
      losses.push(ir.loss(`source table not extracted: ${cells.slice(0, 6).join(" | ")}`, "source-table-diff"));
    }
  }
  return losses;
}
