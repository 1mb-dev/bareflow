// The loss-marker inventory gate. For each fixture page, assert that every inventoried
// load-bearing block is present in the typed IR or carried by a loss block (the source-loss
// audit marks extractor drops). Negative inventory (denyLoss) asserts chrome strings never
// appear in a loss block. A mutation test proves the audit actually detects drops. Plus a
// determinism check over a pinned snapshot. Exit 1 on any failure.
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, VERSION } from "./pipeline.js";
import { auditSourceLoss } from "./loss-audit.js";
import { cacheKey } from "./cache.js";
import { handle } from "./worker.js";
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

// Document-unit round-trip: compose a page with its next sibling pinned, assert the sibling's
// blocks equal its own single-page run, order is prev < page < next, and it is deterministic.
{
  const introUrl = "https://docs.python.org/3/tutorial/introduction.html";
  const cfUrl = "https://docs.python.org/3/tutorial/controlflow.html";
  const introHtml = await readFile(join(ROOT, "test/fixtures/python-tutorial-intro.html"), "utf8");
  const cfHtml = await readFile(join(ROOT, "test/fixtures/python-tutorial-controlflow.html"), "utf8");

  const cfSingle = await run({ url: cfUrl, html: cfHtml, retrievedAt: FIXED });
  const composed = await run({ url: introUrl, html: introHtml, siblings: { [cfUrl]: cfHtml }, retrievedAt: FIXED });
  const secs = composed.doc.sections;

  record("document-unit", "order", "prev < page < next",
    secs.length === 3 && secs[0].url.endsWith("interpreter.html") && secs[1].url === introUrl && secs[2].url === cfUrl);

  const findSection = (sections, u) => {
    for (const s of sections) {
      if (s.url === u) return s;
      const found = findSection(s.children, u);
      if (found) return found;
    }
    return null;
  };
  const nextSection = secs.find((s) => s.url === cfUrl);
  const cfPage = findSection(cfSingle.doc.sections, cfUrl);
  record("document-unit", "round-trip", "sibling blocks equal single-page run",
    !!nextSection && nextSection.blocks.length > 0 && JSON.stringify(nextSection.blocks) === JSON.stringify(cfPage.blocks));

  const again = await run({ url: introUrl, html: introHtml, siblings: { [cfUrl]: cfHtml }, retrievedAt: FIXED });
  record("document-unit", "determinism", "", JSON.stringify(composed.doc) === JSON.stringify(again.doc));
}

// Agent surface: versioned stale-first KV cache + HTTP handler.
{
  const makeKv = () => {
    const m = new Map();
    return {
      async get(key, type) { const v = m.get(key); return v == null ? null : (type === "json" ? JSON.parse(v) : v); },
      async put(key, value) { m.set(key, value); },
      _map: m,
    };
  };
  const doc = { schema: "mdflow/ir/v1", id: "x", title: "T", source: { url: "u", retrievedAt: "2026-01-01", fingerprint: "f" }, generator: { name: "mdflow", version: "0.1.0", extractor: "defuddle", extractorVersion: "0.19.4", config: {} }, sections: [] };
  const markdown = "# T\n";
  const snapshot = { retrievedAt: "2026-01-01", fingerprint: "f" };
  let calls = 0;
  const okRun = async () => { calls++; return { doc, markdown, snapshot }; };
  const failRun = async () => { throw new Error("upstream down"); };
  const req = (q = "https://example.com") => new Request(`https://m/?url=${q}`);

  record("agent-surface", "version-pin", "", cacheKey("https://e.com", "0.1.0") !== cacheKey("https://e.com", "0.2.0"));

  const kv = makeKv();
  const key = cacheKey("https://example.com", VERSION);

  const r1 = await handle(req(), {}, { run: okRun, kv });
  record("agent-surface", "cache", "miss", r1.headers.get("x-mdflow-cache") === "miss" && calls === 1);

  const r2 = await handle(req(), {}, { run: okRun, kv });
  record("agent-surface", "cache", "hit", r2.headers.get("x-mdflow-cache") === "hit" && calls === 1);

  kv._map.delete(key); // simulate fresh expiry, keep the stale fallback
  const r3 = await handle(req(), {}, { run: failRun, kv });
  record("agent-surface", "cache", "hit-stale", r3.headers.get("x-mdflow-cache") === "hit-stale" && r3.headers.get("x-mdflow-retrieved-at") === "2026-01-01");

  const r4 = await handle(req(), {}, { run: failRun, kv: makeKv() });
  record("agent-surface", "cache", "502", r4.status === 502);

  const r5 = await handle(req("https://example.com&format=json"), {}, { run: okRun, kv: makeKv() });
  record("agent-surface", "format", "json", (await r5.text()).includes('"schema"'));
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.kind}  ${r.text}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
