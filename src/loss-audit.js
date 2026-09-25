// Source-loss audit: diff load-bearing blocks (headings, code, tables) in the raw HTML
// against the extracted IR and emit a loss marker per drop. Multiset identity, so duplicate
// blocks are counted and a dropped copy is still flagged. The scope is the page's own
// landmark (see auditScope); chrome inside it is excluded by SKIP. A conservative heuristic,
// not a content detector.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

// Chrome inside the scope: the standard navigation roles, aside, plus one site pattern the
// truth fixtures need (k8s feedback). aside costs one miss (caniuse usage data sits in one)
// and saves five FPs (golang's link sidebar); both sit inside article, so no standard rule
// separates them. Bare header/footer are sectioning content inside main or article, chrome
// only page-wide.
// Hidden content is never content: the extractor drops it, and re-emitting it would hand an
// agent text the page's author hid.
const HIDDEN = "[hidden], [aria-hidden='true'], noscript, template, [style*='display:none'], [style*='display: none']";
const SKIP = `nav, aside, [role='navigation'], [role='banner'], [id*='feedback'], ${HIDDEN}`;
const SKIP_PAGE = `${SKIP}, header, footer`;

// \p{Cf} (ZWSP in VitePress headings, BOM) is invisible and must not break identity.
const norm = (s) => (s || "").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
const aggressive = (s) => norm(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Strip a leading section number ("3.1.", "3.1 ", "3.") so source and IR headings compare even
// when one side drops the numbering; a number without a dot ("2024 Roadmap") is text.
const headingWords = (t) => norm(t).replace(/^(\d+\.)+\d*\s+/, "").toLowerCase();
// Identity is whitespace-free: inline code in a heading joins with or without a space ("the
// ?: operator" in source, "the?: operator" in the IR).
const headingKey = (t) => headingWords(t).replace(/\s/g, "");
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

  // One pass in document order, so each code block knows the heading it sits under.
  const headings = [], codes = [], tables = [];
  for (const el of root.querySelectorAll("h1, h2, h3, h4, h5, h6, pre")) {
    if (el.closest(skip)) continue;
    const t = norm(el.textContent);
    if (el.tagName === "PRE") { if (t) codes.push({ key: t, raw: el.textContent, under: headings.length - 1 }); continue; }
    const text = t.replace(/\s*¶\s*$/, "");
    if (text) headings.push({ level: Number(el.tagName[1]), text, raw: el.textContent });
  }
  // Innermost tables only: an outer (layout) table's rows and cells contain every nested
  // table, which multiplies the audit's output with nesting depth.
  for (const tbl of root.querySelectorAll("table")) {
    if (tbl.closest(skip) || tbl.querySelector("table")) continue;
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
// a drop). The first row is the header row and is not counted as data, unless it is the only row.
function tableSurvived(rows, tables, fullText) {
  if (take(tables, tableKey(rows.flat()))) return true;
  const data = (rows.length > 1 ? rows.slice(1) : rows).flat().map(cellNorm).filter(Boolean);
  if (!data.length) return true;
  const hits = data.filter((c) => fullText.includes(c));
  return hits.length / data.length >= 0.6;
}

// Match source headings to IR headings in document order. Returns, per source heading, the
// IR block index it matched, "title" for the first heading that became the document title, or
// null.
function placeHeadings(headings, blocks, titleKey) {
  const byKey = new Map(); // key -> unused IR heading indices, ascending
  blocks.forEach((b, i) => {
    if (b.type !== "heading") return;
    const k = headingKey(b.text);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  });
  let cursor = -1, titled = false;
  return headings.map((h) => {
    const k = headingKey(h.text);
    if (k === titleKey && !titled) { titled = true; return "title"; }
    const free = byKey.get(k);
    if (!free?.length) return null;
    const at = Math.max(0, free.findIndex((i) => i > cursor));
    const [i] = free.splice(at, 1);
    cursor = Math.max(cursor, i);
    return i;
  });
}

// Per source heading j, the IR index of the nearest placed heading at or before j (-1 if none)
// and at or after j (blocks.length if none). Linear, so window lookups are O(1).
function neighbours(placed, n) {
  const num = (x) => typeof x === "number";
  const before = [], after = [];
  let last = -1;
  for (let j = 0; j < placed.length; j++) { if (num(placed[j])) last = placed[j]; before[j] = last; }
  last = n;
  for (let j = placed.length - 1; j >= 0; j--) { if (num(placed[j])) last = placed[j]; after[j] = last; }
  return { before: (j) => (j < 0 ? -1 : before[j]), after: (j) => (j >= placed.length ? n : after[j]) };
}

// Text keys of the IR's prose blocks, computed once per audit.
function proseKeys(blocks) {
  return blocks.map((b) => {
    const text = b.type === "list" ? b.items.join(" ") : b.type === "heading" ? null : b.text;
    return typeof text === "string" ? { words: headingWords(text), code: codeKey(text) } : null;
  });
}

// A missing heading is demoted, not lost, only when a prose block between its placed
// neighbours starts with its text as a whole word. Matching anywhere in the IR would file real
// drops of short headings ("Note", "Usage") as demoted; so does a window with no placed
// neighbour at all, which spans the whole page. The scan stops DEMOTE_SCAN blocks in: a
// demotion sits where the heading was, and an unbounded scan is quadratic on large pages.
const DEMOTE_SCAN = 200;
function demotedTo(lo, hi, h, blocks, keys, claimed) {
  if (lo === -1 && hi === blocks.length) return null;
  const w = headingWords(h.text);
  for (let i = lo + 1; i < Math.min(hi, lo + 1 + DEMOTE_SCAN); i++) {
    const k = keys[i];
    if (!k || claimed.has(i) || !k.words.startsWith(w)) continue;
    if (/[a-z0-9]$/.test(w) && /^[a-z0-9]/.test(k.words.slice(w.length))) continue;
    claimed.add(i);
    return blocks[i];
  }
  return null;
}

// A missing code block is demoted when its text sits inside a prose block in the same
// section (Defuddle flattens <details> and some editors into paragraphs). Containment is safe
// for code as it is not for headings only above a length floor; shorter code stays a diff.
const DEMOTE_MIN_CODE = 20;
function codeDemotedTo(lo, hi, code, blocks, keys) {
  const k = codeKey(code.key);
  if (k.length < DEMOTE_MIN_CODE || (lo === -1 && hi === blocks.length)) return null;
  for (let i = lo + 1; i < Math.min(hi, lo + 1 + DEMOTE_SCAN); i++) if (keys[i]?.code.includes(k)) return blocks[i];
  return null;
}

// Flattened: the source has structure and the IR kept almost none of it (one paragraph for
// a whole page). The thresholds were fitted on one page (tailwind) and checked out of sample
// (github-blog-rust fires, devto-event-loop does not); a new hit is a labelling task.
const FLAT_MIN_SOURCE = 5, FLAT_MAX_RATIO = 0.1;
function flattened(src, blocks) {
  const n = src.headings.length + src.codes.length;
  const kept = blocks.filter((b) => ["heading", "code", "table", "list"].includes(b.type)).length;
  return n >= FLAT_MIN_SOURCE && kept / n <= FLAT_MAX_RATIO ? { n, kept } : null;
}

// Page text in a finding's reason is clipped; the full block text is in the finding's `text`.
const clip = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Per-block findings per page. Past the cap the rest are counted, not classified: bounded work
// and output on a hostile or huge page. No fixture comes near it.
const MAX_BLOCK_FINDINGS = 500;

export function auditSourceLoss(html, blocks, title = "") {
  const src = sourceBlocks(html);
  const irc = irCounts(blocks);
  const losses = [];

  // On a flattened page every surviving block is prose, so a per-block finding whose text is in
  // the IR is a demotion wherever it sits; one whose text is gone stays a diff.
  const flat = flattened(src, blocks);
  const flatText = flat ? codeKey(blocks.map((b) => b.text ?? b.code ?? (b.items || []).join(" ")).join(" ")).toLowerCase() : "";
  const survives = (raw) => flat && flatText.includes(codeKey(raw).toLowerCase());
  if (flat) {
    losses.push(ir.loss(`extraction flattened: the IR kept ${flat.kept} of ${flat.n} source headings and code blocks as structure`, "extract-flattened"));
  }

  if (!src.headings.length && !src.codes.length && !src.tables.length &&
      blocks.some((b) => b.type === "heading" || b.type === "code" || b.type === "table")) {
    losses.push(ir.loss("audit scope has no headings, code, or tables but the IR does: the audit could not read this page", "audit-scope-empty"));
  }

  const placed = placeHeadings(src.headings, blocks, headingKey(title));
  const nb = neighbours(placed, blocks.length);
  const keys = proseKeys(blocks);
  const claimed = new Set();
  const pageLevel = losses.length;
  let omitted = 0;
  const full = () => losses.length - pageLevel >= MAX_BLOCK_FINDINGS && ++omitted;
  src.headings.forEach((h, j) => {
    if (placed[j] !== null || full()) return;
    const to = demotedTo(nb.before(j - 1), nb.after(j + 1), h, blocks, keys, claimed) ?? (survives(h.text) ? { type: "prose" } : null);
    if (to) losses.push(ir.loss(`source heading demoted to ${to.type} (h${h.level}): ${clip(h.text)}`, "source-heading-demoted", h.raw));
    else losses.push(ir.loss(`source heading not extracted (h${h.level}): ${clip(h.text)}`, "source-heading-diff", h.raw));
  });
  for (const code of src.codes) {
    if (take(irc.codes, codeKey(code.key)) || full()) continue;
    const to = codeDemotedTo(nb.before(code.under), nb.after(code.under + 1), code, blocks, keys) ?? (survives(code.key) ? { type: "prose" } : null);
    if (to) losses.push(ir.loss(`source code block demoted to ${to.type}: ${clip(code.key, 80)}`, "source-code-demoted", code.raw));
    else losses.push(ir.loss(`source code block not extracted: ${clip(code.key, 80)}`, "source-code-diff", code.raw));
  }
  for (const { rows, raw } of src.tables) {
    if (!tableSurvived(rows, irc.tables, irc.fullText) && !full()) {
      losses.push(ir.loss(`source table not extracted: ${clip(rows.flat().slice(0, 6).join(" | "))}`, "source-table-diff", raw));
    }
  }
  if (omitted) losses.push(ir.loss(`audit stopped at ${MAX_BLOCK_FINDINGS} findings: ${omitted} more missing headings, code blocks, or tables not reported`, "audit-truncated"));
  return losses;
}
