// The loss-marker inventory gate. For each fixture page, assert that every inventoried
// load-bearing block is present in the typed IR or carried by a loss block (the source-loss
// audit marks extractor drops). Plus a determinism check over a pinned snapshot. Exit 1 on
// any failure.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./pipeline.js";
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
const count = (doc, type) => blocks(doc).filter((b) => b.type === type).length;
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
    else if (e.kind === "loss") ok = lossMentions(doc, e.text);
    else if (e.kind === "code") ok = count(doc, "code") >= (e.min ?? 1);
    else if (e.kind === "table") ok = count(doc, "table") >= (e.min ?? 1);
    record(id, e.kind, e.text || `(min ${e.min})`, ok);
  }

  // Determinism: same snapshot + pinned retrievedAt -> byte-identical IR.
  const { doc: again } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "determinism", "", JSON.stringify(doc) === JSON.stringify(again));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.kind}  ${r.text}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
