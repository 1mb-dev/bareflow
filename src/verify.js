// The loss-marker inventory gate. For each fixture page, assert that every inventoried
// load-bearing block is present in the typed IR or carried by a loss block (the source-loss
// audit marks extractor drops). Negative inventory (denyLoss) asserts chrome strings never
// appear in a loss block. A mutation test proves the audit actually detects drops. Plus a
// determinism check over a pinned snapshot. Exit 1 on any failure.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./pipeline.js";
import { auditSourceLoss } from "./loss-audit.js";
import { walk } from "./ir.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(await readFile(join(ROOT, "test/inventory.json"), "utf8"));
const FIXED = "2026-01-01T00:00:00.000Z";

const sectionTitles = (doc) => {
  const out = [];
  const rec = (s) => { if (s.title) out.push(s.title); s.children.forEach(rec); };
  doc.sections.forEach(rec);
  return out;
};
const blocks = (doc) => [...walk(doc)].map(({ block }) => block);
const lossMentions = (doc, text) =>
  blocks(doc).some((b) => b.type === "loss" && `${b.reason} ${b.source || ""}`.includes(text));

const results = [];
const record = (id, kind, text, ok) => results.push({ id, kind, text, ok });

for (const [id, spec] of Object.entries(inventory)) {
  const html = await readFile(join(ROOT, "test/fixtures", spec.fixture), "utf8");
  const { doc } = await run({ url: spec.url, html, retrievedAt: FIXED });
  const titles = sectionTitles(doc);
  const bs = blocks(doc);

  for (const e of spec.expect) {
    let ok = false;
    if (e.kind === "sibling") ok = titles.some((t) => t.includes(e.text));
    else if (e.kind === "heading") ok = bs.some((b) => b.type === "heading" && b.text.includes(e.text)) || lossMentions(doc, e.text);
    else if (e.kind === "code") ok = bs.some((b) => b.type === "code" && b.code.includes(e.contains)) || lossMentions(doc, e.contains);
    else if (e.kind === "loss") ok = lossMentions(doc, e.text);
    else if (e.kind === "table") ok = bs.some((b) => b.type === "table") || lossMentions(doc, e.text);
    record(id, e.kind, e.text || e.contains || "(table)", ok);
  }

  // Negative inventory: chrome strings must not appear in any loss block.
  for (const deny of spec.denyLoss || []) {
    const leaked = bs.some((b) => b.type === "loss" && `${b.reason} ${b.source || ""}`.includes(deny));
    record(id, "denyLoss", deny, !leaked);
  }

  // Determinism: same snapshot + pinned retrievedAt -> byte-identical IR.
  const { doc: again } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "determinism", "", JSON.stringify(doc) === JSON.stringify(again));
}

// Mutation test: drop a known code block from the IR; the audit must flag it as a loss.
{
  const anchor = "let x = 5";
  const html = await readFile(join(ROOT, "test/fixtures/rust-book-ownership.html"), "utf8");
  const { doc } = await run({
    url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
    html,
    retrievedAt: FIXED,
  });
  const base = blocks(doc).filter((b) => b.type !== "loss");
  const without = base.filter((b) => !(b.type === "code" && b.code.includes(anchor)));
  const losses = auditSourceLoss(html, without, "Ownership Rules");
  record("mutation", "loss", anchor, losses.some((l) => l.reason.includes(anchor)));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.kind}  ${r.text}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
