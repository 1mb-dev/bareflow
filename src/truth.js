// Truth harness: scores the source-loss audit and nav detection against hand labels in
// test/inventory.json. It owns its normalizer on purpose: importing loss-audit.js's would let
// a normalization bug there hide itself here.
//
// Universe: every h1-h6, pre, and table under documentElement (not body: linkedom can parse
// content outside body). Each block is `present` unless labelled lost | demoted | chrome.
// A label is {kind, key}; key is the block's normalized text or a prefix of it (an exact match
// wins), and must not match two distinct blocks. `flattened` labels the page as a whole and is
// scored as its own row, not pooled into block precision. Every known_fp entry carries a `why`.
import { parseHTML } from "linkedom";
import { walk } from "./ir.js";
import { extractNav, canonicalUrl } from "./compose.js";

// Lines of a code block as layout: \p{Cf} removed, trailing whitespace, blank edge lines and
// repeated blank lines dropped (blank-line counts are not syntax; Defuddle collapses them),
// common leading indentation removed.
function lineLayout(code) {
  const lines = (code || "").replace(/\p{Cf}/gu, "").replace(/\n\s*\n(\s*\n)+/g, "\n\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^\s*/)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
}

const vnorm = (s) => (s || "").normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim();
// Permalink glyphs trail headings on Sphinx (¶) and VitePress (#). "C#" has no space, so it stays.
const headingText = (s) => vnorm(s).replace(/\s*¶$|\s+#$/u, "");
const tableText = (cells) => vnorm(cells.join(" | "));
// Block identity ignores whitespace: inline elements join with or without a space depending
// on the renderer ("Specification#" in source, "Specification #" in the IR).
const loose = (t) => t.replace(/\s/g, "");

const AUDIT_KIND = {
  "source-heading-diff": "heading", "source-heading-demoted": "heading",
  "source-code-diff": "code", "source-code-demoted": "code", "source-table-diff": "table",
};
const LABELS = ["lost", "demoted", "chrome"];

// The code in a <pre> is its top-level <code> elements when it has any; the rest (toggles,
// language labels, copy buttons) is interface.
function codeOf(pre) {
  const codes = [...pre.querySelectorAll("code")].filter((c) => !c.parentElement.closest("code"));
  return codes.length ? codes.map((c) => c.textContent).join("\n") : pre.textContent;
}
// A heading's text without same-page anchors that hold only a glyph (#, ¶, §).
function withoutPermalinks(h) {
  const c = h.cloneNode(true);
  for (const a of c.querySelectorAll("a[href^='#']")) if (/^\s*[#¶§]\s*$/u.test(a.textContent)) a.remove();
  return c.textContent;
}

function universe(html) {
  const { document } = parseHTML(html);
  const out = [];
  for (const el of document.documentElement.querySelectorAll("h1, h2, h3, h4, h5, h6, pre, table")) {
    const tag = el.tagName.toLowerCase();
    const kind = tag === "pre" ? "code" : tag === "table" ? "table" : "heading";
    const text = kind === "heading" ? headingText(withoutPermalinks(el))
      : kind === "code" ? vnorm(codeOf(el))
      : tableText([...el.querySelectorAll("th, td")].map((c) => c.textContent));
    const raw = kind === "code" ? codeOf(el) : null;
    const cells = kind === "table" ? [...el.querySelectorAll("td")].map((c) => loose(vnorm(c.textContent))).filter(Boolean) : null;
    const level = kind === "heading" ? Number(tag[1]) : null;
    if (text) out.push({ kind, text, raw, cells, level, label: "present" });
  }
  return out;
}

// Section titles count as headings: the page h1 becomes the page section's title, not a block.
function irTexts(doc) {
  const m = { heading: [], code: [], table: [] };
  const titles = (s) => { m.heading.push(loose(headingText(s.title))); s.children.forEach(titles); };
  doc.sections.forEach(titles);
  for (const { block: b } of walk(doc)) {
    if (b.type === "heading") m.heading.push(loose(headingText(b.text)));
    else if (b.type === "code") m.code.push(loose(vnorm(b.code)));
    else if (b.type === "table") m.table.push(loose(tableText([...b.headers, ...b.rows.flat()])));
  }
  return m;
}

function auditLosses(doc) {
  const out = [];
  const rec = (s) => { for (const l of s.losses) if (AUDIT_KIND[l.source] || l.source === "audit-scope-empty" || l.source === "extract-flattened") out.push(l); s.children.forEach(rec); };
  doc.sections.forEach(rec);
  return out.map((l) => ({
    source: l.source,
    kind: AUDIT_KIND[l.source],
    text: AUDIT_KIND[l.source] === "heading" ? headingText(l.text) : vnorm(l.text),
  }));
}

// Resolve {kind, key} entries against items; returns [matchedItems, errors]. Each entry
// consumes one item; an entry whose prefix spans two distinct texts is ambiguous.
function resolve(entries, items, what) {
  const used = new Set(), hits = [], errors = [];
  for (const e of entries) {
    const open = items.filter((it, i) => !used.has(i) && it.kind === e.kind);
    const exact = open.filter((it) => it.text === e.key);
    const cands = exact.length ? exact : open.filter((it) => it.text.startsWith(e.key));
    const distinct = new Set(cands.map((c) => c.text));
    if (!cands.length) { errors.push(`${what} matches nothing: ${e.kind} "${e.key}"`); continue; }
    if (distinct.size > 1) { errors.push(`${what} is ambiguous (${distinct.size} blocks): ${e.kind} "${e.key}"`); continue; }
    const i = items.indexOf(cands[0]);
    used.add(i);
    hits.push(cands[0]);
  }
  return [hits, errors];
}

// Score one fixture's audit. errors fail the gate; the counts are reported.
export function scoreLoss(html, doc, spec) {
  const errors = [];
  const items = universe(html);
  for (const label of LABELS) {
    const [hits, errs] = resolve(spec.labels?.[label] || [], items.filter((it) => it.label === "present"), `label ${label}`);
    for (const h of hits) h.label = label;
    errors.push(...errs);
  }

  // Label sanity against the IR: present must be there, lost must not be.
  const ir = irTexts(doc);
  // Code identity is loose for matching, exact for layout: a matched multi-line block must keep
  // every line, after a common dedent and trailing-whitespace strip (indentation is syntax in
  // Python and YAML). Source code rendered as one <div> per line has no newlines in its
  // textContent and is checked loosely only.
  const irCode = new Map();
  for (const { block: b } of walk(doc)) if (b.type === "code") irCode.set(loose(vnorm(b.code)), b.code);
  const drifts = [];
  const inIr = (it) => {
    const i = ir[it.kind].indexOf(loose(it.text));
    if (i < 0) return false;
    ir[it.kind].splice(i, 1);
    if (it.kind === "code" && lineLayout(it.raw).length > 1) {
      const got = irCode.get(loose(it.text));
      if (lineLayout(got).join("\n") !== lineLayout(it.raw).join("\n")) drifts.push({ kind: "code", text: it.text });
    }
    return true;
  };
  const irProse = loose([...walk(doc)].map(({ block: b }) => b.text ?? b.code ?? (b.items || []).join(" ")).join(" "));
  for (const it of items) {
    // A demoted table survives as prose cell by cell, not as its joined text.
    const survives = it.kind === "table" ? it.cells.filter((c) => irProse.includes(c)).length >= 0.9 * it.cells.length : irProse.includes(loose(it.text));
    if (it.label === "demoted" && !survives) errors.push(`labelled demoted but text not in IR: ${it.kind} "${it.text.slice(0, 80)}"`);
    const found = it.label === "chrome" || it.label === "demoted" ? null : inIr(it);
    if (it.label === "present" && !found) errors.push(`unlabelled drop: ${it.kind} "${it.text.slice(0, 80)}"`);
    if (it.label === "lost" && found) errors.push(`labelled lost but in IR: ${it.kind} "${it.text.slice(0, 80)}"`);
  }

  const [knownDrift, driftErrs] = resolve(spec.known_code_drift || [], drifts, "known_code_drift");
  errors.push(...driftErrs.map((e) => `${e} (stale: remove it)`));
  for (const e of spec.known_code_drift || []) if (!e.why) errors.push(`known_code_drift without a why: "${e.key}"`);
  for (const d of drifts) if (!knownDrift.includes(d)) errors.push(`code layout changed: "${d.text.slice(0, 60)}"`);

  // Emitted findings against labels, as a multiset.
  // A demoted finding is right only on a demoted label, and sits outside precision: it reports a
  // type change, not missing content. Any other finding on a non-lost block is a false positive.
  const pool = items.map((it) => ({ ...it }));
  let tp = 0, demoted = 0;
  const fps = [];
  const findings = auditLosses(doc);
  const flatEmitted = findings.some((f) => f.source === "extract-flattened");
  if (flatEmitted && !spec.flattened) errors.push("extract-flattened on a page labelled not flattened");
  if (!flatEmitted && spec.flattened) errors.push("page labelled flattened but extract-flattened not emitted");
  for (const e of spec.known_fp || []) if (!e.why) errors.push(`known_fp without a why: ${e.kind} "${e.key}"`);
  for (const f of findings) {
    if (f.source === "extract-flattened") continue;
    if (f.source === "audit-scope-empty") { errors.push("audit scope empty: the auditor could not read this fixture"); continue; }
    const want = f.source.endsWith("-demoted") ? "demoted" : "lost";
    const i = pool.findIndex((it) => !it.taken && it.kind === f.kind && loose(it.text) === loose(f.text));
    if (i >= 0) pool[i].taken = true;
    if (i >= 0 && pool[i].label === want) { if (want === "lost") tp++; else demoted++; continue; }
    fps.push({ kind: f.kind, text: f.text, label: i >= 0 ? pool[i].label : "unmatched" });
  }
  const misses = pool.filter((it) => it.label === "lost" && !it.taken);

  // Baseline: named known FPs and misses are allowed; anything else, or a stale entry, fails.
  const [knownFp, fpErrs] = resolve(spec.known_fp || [], fps, "known_fp");
  const [knownMiss, missErrs] = resolve(spec.known_miss || [], misses, "known_miss");
  errors.push(...fpErrs.map((e) => `${e} (stale: remove it)`), ...missErrs.map((e) => `${e} (stale: remove it)`));
  for (const f of fps) if (!knownFp.includes(f)) errors.push(`new false positive (${f.label}): ${f.kind} "${f.text.slice(0, 80)}"`);
  for (const m of misses) if (!knownMiss.includes(m)) errors.push(`new miss: ${m.kind} "${m.text.slice(0, 80)}"`);

  // Structure is baselined like the rest: a new diff fails, a stale known_structure entry fails.
  const structure = structureDiffs(items, doc);
  const [knownStruct, structErrs] = resolve(spec.known_structure || [], structure, "known_structure");
  errors.push(...structErrs.map((e) => `${e} (stale: remove it)`));
  for (const e of spec.known_structure || []) if (!e.why) errors.push(`known_structure without a why: ${e.kind} "${e.key}"`);
  for (const d of structure) if (!knownStruct.includes(d)) errors.push(`structure changed (${d.kind}): "${d.text.slice(0, 60)}" ${d.detail.slice(0, 80)}`);

  const lost = items.filter((it) => it.label === "lost").length;
  return {
    errors,
    fps,
    misses,
    counts: { universe: items.length, lost, tp, fp: fps.length, miss: misses.length, demoted },
    structure: structure.length,
    flat: { labelled: !!spec.flattened, emitted: flatEmitted },
    precision: tp + fps.length ? tp / (tp + fps.length) : null,
    recall: lost ? tp / lost : null,
  };
}

// Structure of the present blocks the IR kept: blocks out of source order (those off the longest
// run in IR order), headings at another level, and code or tables filed under another heading.
// A section title is a level-1 heading at the section's start. Each diff is {kind, text}, with
// kind order | level | section and text the source block's.
function structureDiffs(items, doc) {
  const seq = [];
  const rec = (s) => {
    seq.push({ kind: "heading", key: loose(headingText(s.title)), level: 1 });
    for (const b of s.blocks) {
      if (b.type === "heading") seq.push({ kind: "heading", key: loose(headingText(b.text)), level: b.level });
      else if (b.type === "code") seq.push({ kind: "code", key: loose(vnorm(b.code)) });
      else if (b.type === "table") seq.push({ kind: "table", key: loose(tableText([...b.headers, ...b.rows.flat()])) });
    }
    s.children.forEach(rec);
  };
  doc.sections.forEach(rec);

  const used = new Set(), matched = [], diffs = [];
  let under = null; // nearest source heading so far, with its IR position if kept
  for (const it of items) {
    const at = it.label === "present" ? seq.findIndex((e, i) => !used.has(i) && e.kind === it.kind && e.key === loose(it.text)) : -1;
    if (at >= 0) { used.add(at); matched.push({ it, at }); }
    if (it.kind === "heading") {
      if (at >= 0 && seq[at].level !== it.level) diffs.push({ kind: "level", text: it.text, detail: `h${it.level} -> h${seq[at].level}` });
      under = { it, at };
      continue;
    }
    if (at < 0 || !under || under.at < 0) continue;
    let h = at;
    while (--h >= 0 && seq[h].kind !== "heading");
    if (h !== under.at) diffs.push({ kind: "section", text: it.text, detail: `under "${h >= 0 ? seq[h].key : "-"}", not "${under.it.text}"` });
  }
  // Longest increasing run of IR positions (O(n log n)); every matched block off it is out of order.
  const tails = [], prev = [];
  matched.forEach(({ at }, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (matched[tails[mid]].at < at) lo = mid + 1; else hi = mid; }
    prev[i] = lo ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const inRun = new Set();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = prev[i]) inRun.add(i);
  matched.forEach(({ it }, i) => { if (!inRun.has(i)) diffs.push({ kind: "order", text: it.text, detail: `${it.kind} out of source order` }); });
  return diffs;
}

// Score nav detection: truth is the page's visible prev/next, "none" when it has none.
export function scoreNav(html, url, truth) {
  const nav = extractNav(html, url).rel;
  const out = { tp: 0, fp: [], miss: [] };
  for (const r of ["prev", "next"]) {
    const want = truth[r] === "none" ? null : canonicalUrl(truth[r]);
    const got = nav[r]?.url ?? null;
    if (got && got === want) out.tp++;
    else {
      if (got) out.fp.push(`${r}: ${got}`);
      if (want) out.miss.push(`${r}: ${want}`);
    }
  }
  return out;
}
