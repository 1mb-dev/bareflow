// Source-loss audit: diff load-bearing blocks (headings, code, tables) in the raw HTML
// against the extracted IR and emit a loss marker per drop. Multiset identity, so duplicate
// blocks are counted and a dropped copy is still flagged. The scope is the page's own
// landmark (see auditScope); chrome inside it is excluded by SKIP. A conservative heuristic,
// not a content detector.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

// Chrome inside the scope: the standard navigation roles plus one site pattern the truth
// fixtures need (k8s feedback). aside is not chrome inside main (caniuse usage data); bare
// header/footer are sectioning content inside main or article, chrome only page-wide.
const SKIP = "nav, [role='navigation'], [role='banner'], [id*='feedback']";
const SKIP_PAGE = `${SKIP}, header, footer`;

// \p{Cf} (ZWSP in VitePress headings, BOM) is invisible and must not break identity.
const norm = (s) => (s || "").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
const aggressive = (s) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Strip a leading section number ("3.1.", "3.1.1.") so source and IR headings compare even
// when one side drops the numbering.
function headingKey(t) {
  return norm(t).replace(/^\d+(\.\d+)*\.?\s+/, "").toLowerCase();
}
// Code lines rendered as <div>s join without a newline in textContent; the IR has one.
const codeKey = (s) => norm(s).replace(/\s/g, "");
const tableKey = (cells) => norm(cells.join(" "));
const cellNorm = (c) => aggressive(norm(c).replace(/#.*$/, ""));

// The page's single main, else single [role=main], else single article, else the whole
// document. Not document.body: linkedom can parse content outside body (react.dev).
function auditScope(document) {
  for (const sel of ["main", "[role='main']", "article"]) {
    const found = document.querySelectorAll(sel);
    if (found.length === 1) return { root: found[0], skip: SKIP };
  }
  return { root: document.documentElement, skip: SKIP_PAGE };
}

function sourceBlocks(html) {
  const { document } = parseHTML(html);
  const { root, skip } = auditScope(document);

  const headings = [], codes = [], tables = [];
  for (const h of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (h.closest(skip)) continue;
    const text = norm(h.textContent).replace(/\s*¶\s*$/, "");
    if (text) headings.push({ level: Number(h.tagName[1]), text, raw: h.textContent });
  }
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.closest(skip)) continue;
    const t = norm(pre.textContent);
    if (t) codes.push({ key: t, raw: pre.textContent });
  }
  for (const tbl of root.querySelectorAll("table")) {
    if (tbl.closest(skip)) continue;
    const rows = [...tbl.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => c.textContent));
    const raw = rows.flat();
    if (raw.length) tables.push({ rows: rows.map((r) => r.map(norm)), raw: raw.join(" | ") });
  }
  return { headings, codes, tables };
}

// Multiset counts of IR code and table blocks keyed by identity, plus the IR's full
// normalized text.
function irCounts(blocks) {
  const codes = new Map(), tables = new Map();
  const text = [];
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const b of blocks) {
    if (b.type === "heading") text.push(b.text);
    else if (b.type === "code") { bump(codes, codeKey(b.code)); text.push(b.code); }
    else if (b.type === "table") { bump(tables, tableKey([...b.headers, ...b.rows.flat()])); text.push(...b.headers, ...b.rows.flat()); }
    else if (b.type === "list") text.push(...b.items);
    else if (b.type === "paragraph" || b.type === "blockquote") text.push(b.text);
  }
  return { codes, tables, fullText: aggressive(text.join(" ")) };
}

function take(map, key) {
  const c = map.get(key) || 0;
  if (c > 0) { map.set(key, c - 1); return true; }
  return false;
}

// A source table survived if it matches an IR table, or most of its data cells appear in
// the IR's text (Defuddle re-renders some tables as lists or prose; that is re-shaping, not
// a drop). The first row is the header row and is not counted as data.
function tableSurvived(rows, tables, fullText) {
  if (take(tables, tableKey(rows.flat()))) return true;
  const data = rows.slice(1).flat().map(cellNorm).filter(Boolean);
  if (!data.length) return true;
  const hits = data.filter((c) => fullText.includes(c));
  return hits.length / data.length >= 0.6;
}

// Match source headings to IR headings in document order. Returns, per source heading, the
// IR block index it matched, "title" for the h1 that became the document title, or null.
function placeHeadings(headings, blocks, titleKey) {
  const irHeads = [];
  blocks.forEach((b, i) => { if (b.type === "heading") irHeads.push({ i, key: headingKey(b.text), used: false }); });
  let cursor = -1;
  return headings.map((h) => {
    const k = headingKey(h.text);
    if (k === titleKey) return "title";
    const m = irHeads.find((x) => !x.used && x.key === k && x.i > cursor) ?? irHeads.find((x) => !x.used && x.key === k);
    if (!m) return null;
    m.used = true;
    cursor = Math.max(cursor, m.i);
    return m.i;
  });
}

// A missing heading is demoted, not lost, only when a non-heading IR block between its
// neighbours' positions starts with its text. Matching anywhere in the IR would file real
// drops of short headings ("Note", "Usage") as demoted.
function demotedTo(j, placed, headings, blocks, claimed) {
  const num = (x) => typeof x === "number";
  const lo = placed.slice(0, j).filter(num).at(-1) ?? -1;
  const hi = placed.slice(j + 1).find(num) ?? blocks.length;
  const k = headingKey(headings[j].text);
  for (let i = lo + 1; i < hi; i++) {
    const b = blocks[i];
    if (claimed.has(i) || b.type === "heading" || typeof b.text !== "string") continue;
    if (headingKey(b.text).startsWith(k)) { claimed.add(i); return b; }
  }
  return null;
}

export function auditSourceLoss(html, blocks, title = "") {
  const src = sourceBlocks(html);
  const irc = irCounts(blocks);
  const losses = [];

  if (!src.headings.length && !src.codes.length && !src.tables.length &&
      blocks.some((b) => b.type === "heading" || b.type === "code" || b.type === "table")) {
    losses.push(ir.loss("audit scope has no headings, code, or tables but the IR does: the audit could not read this page", "audit-scope-empty"));
  }

  const placed = placeHeadings(src.headings, blocks, headingKey(title));
  const claimed = new Set();
  src.headings.forEach((h, j) => {
    if (placed[j] !== null) return;
    const to = demotedTo(j, placed, src.headings, blocks, claimed);
    if (to) losses.push(ir.loss(`source heading demoted to ${to.type} (h${h.level}): ${h.text}`, "source-heading-demoted", h.raw));
    else losses.push(ir.loss(`source heading not extracted (h${h.level}): ${h.text}`, "source-heading-diff", h.raw));
  });
  for (const code of src.codes) {
    if (!take(irc.codes, codeKey(code.key))) {
      losses.push(ir.loss(`source code block not extracted: ${code.key.slice(0, 80)}`, "source-code-diff", code.raw));
    }
  }
  for (const { rows, raw } of src.tables) {
    if (!tableSurvived(rows, irc.tables, irc.fullText)) {
      losses.push(ir.loss(`source table not extracted: ${rows.flat().slice(0, 6).join(" | ")}`, "source-table-diff", raw));
    }
  }
  return losses;
}
