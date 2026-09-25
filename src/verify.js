// The gate: scores the loss audit and nav detection against hand-labelled truth
// (test/inventory.json, via src/truth.js), fails on any false positive or miss not named in the
// fixture's known_fp / known_miss baseline, and checks wiring, mutation, SSRF, and the handler
// boundary. Determinism compares a pure function to itself (near-tautological). Exit 1 on any
// failure.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { run } from "./pipeline.js";
import { auditSourceLoss } from "./loss-audit.js";
import { contentToBlocks } from "./to-ir.js";
import { decompress, MAX_BYTES } from "./fetch.js";
import { cacheKey } from "./cache.js";
import { isPrivateIp } from "./ssrf.js";
import { handle } from "./worker.js";
import { walk, SCHEMA } from "./ir.js";
import { scoreLoss, scoreNav } from "./truth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(await readFile(join(ROOT, "test/inventory.json"), "utf8"));
const FIXED = "2026-01-01T00:00:00.000Z";

const blocks = (doc) => [...walk(doc)].map(({ block }) => block);
const results = [];
const record = (id, kind, text, ok) => results.push({ id, kind, text, ok });

const truth = [];
const pr = (n, d) => (d ? (n / d).toFixed(2) : "-");
for (const [id, spec] of Object.entries(inventory)) {
  const html = await readFile(join(ROOT, "test/fixtures", spec.fixture), "utf8");
  record(id, "fixture", "sha256", createHash("sha256").update(html).digest("hex") === spec.sha256);
  const { doc } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "schema", SCHEMA, doc.schema === SCHEMA);

  const nav = scoreNav(html, spec.url, spec.nav);
  for (const f of nav.fp) record(id, "nav", `wrong sibling ${f}`, false);
  const row = { id, nav };
  if (spec.audit !== false) {
    const loss = scoreLoss(html, doc, spec);
    for (const e of loss.errors) record(id, "truth", e, false);
    if (!loss.errors.length) record(id, "truth", "labels resolve; findings match baseline", true);
    row.loss = loss.counts;
  }
  truth.push(row);

  // Determinism: same snapshot + pinned retrievedAt -> byte-identical IR.
  const { doc: again } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "determinism", "", JSON.stringify(doc) === JSON.stringify(again));
}

// Truth harness self-test: the gate must fail on a new false positive, a new miss, an
// unlabelled drop, and a stale baseline entry, or a green run proves nothing.
{
  const url = "https://example.com/t/";
  const html = `<html><body><nav><h2>Menu</h2></nav><main><h1>T</h1><h2>Kept</h2><p>x</p>
    <h2>Gone</h2><pre>code()</pre></main></body></html>`;
  const { doc } = await run({ url, html, retrievedAt: FIXED });
  const H = (key) => ({ kind: "heading", key });
  const chrome = [H("Menu")];
  const errors = (d, spec) => scoreLoss(html, d, { ...spec, labels: { chrome, ...spec.labels } }).errors;
  const fails = (d, spec, re) => errors(d, spec).some((e) => re.test(e));
  // withLosses: the page with "Gone" cut from its blocks and the given audit findings attached.
  const page = doc.sections[0];
  const finding = (text) => ({ type: "loss", reason: "r", source: "source-heading-diff", text });
  const withLosses = (cutGone, ...texts) => ({ ...doc, sections: [{ ...page,
    blocks: cutGone ? page.blocks.filter((b) => b.text !== "Gone") : page.blocks, losses: texts.map(finding) }] });
  const lost = { labels: { lost: [H("Gone")] } };
  record("truth-harness", "fails on", "unlabelled drop", fails(withLosses(true, "Gone"), {}, /^unlabelled drop/));
  record("truth-harness", "passes on", "labelled loss emitted", errors(withLosses(true, "Gone"), lost).length === 0);
  record("truth-harness", "fails on", "new miss", fails(withLosses(true), lost, /^new miss/));
  record("truth-harness", "fails on", "new false positive", fails(withLosses(false, "Kept"), {}, /^new false positive/));
  record("truth-harness", "fails on", "stale known_fp", fails(doc, { known_fp: [H("Kept")] }, /stale/));
  record("truth-harness", "fails on", "ambiguous label", fails(doc, { labels: { lost: [H("")] } }, /ambiguous/));
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
  const base = blocks(doc);
  const without = base.filter((b) => !(b.type === "code" && b.code.includes(anchor)));
  const losses = auditSourceLoss(html, without, "Ownership Rules");
  record("mutation", "loss", anchor, losses.some((l) => l.reason.includes(anchor)));
}

// Auditor rules the fixtures do not isolate.
{
  const src = (l) => l.map((x) => x.source);
  const P = (text) => ({ type: "paragraph", text });
  const Hd = (text) => ({ type: "heading", level: 2, text });

  // Demoted only at the heading's position: "Note:" between A and B is demoted; a "Usage"
  // heading whose only look-alike paragraph sits in another section is lost.
  const demo = auditSourceLoss("<main><h2>A</h2><p>x</p><h4>Note:</h4><p>y</p><h2>B</h2><h3>Usage</h3><h2>C</h2></main>",
    [Hd("A"), P("x"), P("Note:"), P("y"), Hd("B"), Hd("C"), P("Usage is simple")]);
  record("loss-audit", "demoted", "at position only",
    JSON.stringify(src(demo)) === JSON.stringify(["source-heading-demoted", "source-heading-diff"]) && demo[0].text === "Note:");

  // A scope with nothing to audit while the IR has structure is reported, not silently clean.
  const blind = auditSourceLoss("<html><body><p>x</p></body></html>", [Hd("Real")]);
  record("loss-audit", "scope", "empty scope reported", JSON.stringify(src(blind)) === JSON.stringify(["audit-scope-empty"]));

  // Inside main, a header is sectioning content, not chrome; page-level header is chrome.
  const hdr = auditSourceLoss("<header><h1>Site</h1></header><main><article><header><h2>Real</h2></header><p>x</p></article></main>", [P("x")]);
  record("loss-audit", "scope", "header inside main audited, page header skipped",
    hdr.length === 1 && hdr[0].text === "Real");

  // Bug 12: the header row is skipped as a row, not as one cell. A table whose data is gone
  // is flagged even though its header text survives; data re-rendered as prose survives.
  const tbl = "<main><table><tr><th>Name</th><th>Kind</th><th>Size</th><th>Mode</th></tr><tr><td>alpha</td></tr></table></main>";
  record("loss-audit", "table", "header row skipped, reshaped data survives",
    auditSourceLoss(tbl, [P("Name Kind Size Mode")]).length === 1 && auditSourceLoss(tbl, [P("alpha")]).length === 0);

  // Bug 13: a figcaption next to an image is kept.
  const fig = contentToBlocks('<figure><img src="a.png" alt="A"><figcaption>Figure caption</figcaption></figure>');
  record("to-ir", "figure", "figcaption kept with image", fig.length === 2 && fig[1].text === "Figure caption");
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

// Document-unit integrity: the compose/to-ir bugs that would ship broken sibling content.
// 9: direct text nodes in containers must survive. 10: a breadcrumb crumb linking to the
// page must not drop prev/next. 11: sibling keys differing only by host casing must attach.
{
  const textOf = (s) => (s?.blocks || []).map((b) => b.text || "").join(" ");
  const find = (doc, u) => {
    const rec = (s) => {
      if (s.url === u) return s;
      for (const c of s.children) { const f = rec(c); if (f) return f; }
      return null;
    };
    for (const s of doc.sections) { const f = rec(s); if (f) return f; }
    return null;
  };
  const prevHtml = "<html><body><main><h1>Prev</h1><p>Prev content.</p></main></body></html>";
  const nextHtml = "<html><body><main><h1>Next</h1><p>Next content.</p></main></body></html>";

  // 10: breadcrumb crumb linking to the page itself.
  {
    const url = "https://example.com/docs/page/";
    const html = `<html><head>
      <link rel="prev" href="/docs/prev/" title="Prev"><link rel="next" href="/docs/next/" title="Next">
      </head><body>
      <nav aria-label="breadcrumb"><a href="/docs/">Docs</a> <a href="/docs/page/">Page</a></nav>
      <main><h1>Page</h1><p>Page content.</p></main>
      </body></html>`;
    const { doc } = await run({ url, html, siblings: {
      "https://example.com/docs/prev/": prevHtml,
      "https://example.com/docs/next/": nextHtml,
    }, retrievedAt: FIXED });
    const prev = find(doc, "https://example.com/docs/prev/");
    const next = find(doc, "https://example.com/docs/next/");
    record("document-unit", "integrity", "breadcrumb page-url keeps prev/next",
      !!prev && !!next && textOf(prev).includes("Prev content") && textOf(next).includes("Next content"));
  }

  // 11: sibling keys that differ only by host casing still attach content.
  {
    const url = "https://example.com/docs/page/";
    const html = `<html><head>
      <link rel="next" href="/docs/next/" title="Next">
      </head><body><main><h1>Page</h1><p>Page content.</p></main></body></html>`;
    const { doc } = await run({ url, html, siblings: {
      "https://EXAMPLE.com/docs/next/": nextHtml,
    }, retrievedAt: FIXED });
    const next = find(doc, "https://example.com/docs/next/");
    record("document-unit", "integrity", "host-cased sibling key attaches content",
      !!next && textOf(next).includes("Next content"));
  }

  // 9: direct text nodes in a transparent container must not be dropped.
  {
    const blocks = contentToBlocks('<div>Hello <b>world</b></div>');
    const text = blocks.map((b) => b.text || "").join(" ");
    record("to-ir", "text-node", "container text preserved", text.includes("Hello") && text.includes("world"));
  }
}

// SSRF denylist: the shared policy blocks the full non-public range and rejects nothing public.
{
  const blocked = ["192.0.2.1", "198.19.255.254", "224.0.0.1", "240.0.0.1", "10.0.0.1", "::ffff:7f00:1", "fd00::1", "fe80::1"];
  const allowed = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "example.com"];
  record("ssrf", "denylist", "non-public blocked, public allowed",
    blocked.every((ip) => isPrivateIp(ip)) && allowed.every((ip) => !isPrivateIp(ip)));
}

// Fetch decompression: a small compressed body must not inflate past the cap, and a bomb must
// yield valid (not raw-compressed) HTML.
{
  const small = gzipSync("hello");
  const bomb = gzipSync(Buffer.alloc(MAX_BYTES * 2, 65)); // 10MB of "A", compresses tiny
  const smallOut = await decompress(small, "gzip");
  const bombOut = await decompress(bomb, "gzip");
  record("fetch", "decompress", "caps decompressed output",
    smallOut.toString() === "hello" && bombOut.length <= MAX_BYTES && bombOut[0] === 0x41);
}

// Live wiring: run({url}) follows rel=prev/next/up through the injected fetch, attaches real
// sibling content, and degrades a dead sibling to a stub rather than crashing.
{
  const introUrl = "https://docs.python.org/3/tutorial/introduction.html";
  const cfUrl = "https://docs.python.org/3/tutorial/controlflow.html";
  const introHtml = await readFile(join(ROOT, "test/fixtures/python-tutorial-intro.html"), "utf8");
  const cfHtml = await readFile(join(ROOT, "test/fixtures/python-tutorial-controlflow.html"), "utf8");
  const snap = (u, html) => ({ url: u, finalUrl: u, status: 200, contentType: "text/html", bytes: Buffer.byteLength(html), html, fingerprint: "f", retrievedAt: FIXED });
  const fakeFetch = async (u) => {
    if (u === introUrl) return snap(u, introHtml);
    if (u === cfUrl) return snap(u, cfHtml);
    throw new Error("no fixture"); // prev/up and any unknown sibling degrade to a stub
  };
  const { doc } = await run({ url: introUrl, fetch: fakeFetch, retrievedAt: FIXED });
  const find = (d, u) => {
    const rec = (s) => {
      if (s.url === u) return s;
      for (const c of s.children) { const f = rec(c); if (f) return f; }
      return null;
    };
    for (const s of d.sections) { const f = rec(s); if (f) return f; }
    return null;
  };
  const next = find(doc, cfUrl);
  const cfSingle = await run({ url: cfUrl, html: cfHtml, retrievedAt: FIXED });
  const cfPage = find(cfSingle.doc, cfUrl);
  record("wiring", "live", "next sibling carries real blocks equal to single-page run",
    !!next && next.blocks.length > 0 && JSON.stringify(next.blocks) === JSON.stringify(cfPage.blocks));

  // SSRF: a sibling URL to a private address is rejected before the fetch.
  {
    const pageUrl = "https://example.com/page/";
    const fetched = [];
    const spy = async (u) => {
      fetched.push(u);
      if (u === pageUrl) return snap(u, `<html><head><link rel="next" href="http://169.254.169.254/"></head><body><main><h1>Page</h1></main></body></html>`);
      throw new Error("unexpected sibling fetch " + u);
    };
    await run({ url: pageUrl, fetch: spy, retrievedAt: FIXED });
    record("wiring", "ssrf", "private sibling rejected before fetch", fetched.length === 1 && fetched[0] === pageUrl);
  }
}

// Agent surface: cache key + HTTP handler boundary.
{
  const makeKv = () => {
    const m = new Map();
    return {
      async get(key, type) { const v = m.get(key); return v == null ? null : type === "json" ? JSON.parse(v) : v; },
      async put(key, value) { m.set(key, value); },
    };
  };
  const doc = { schema: "mdflow/ir/v1", id: "x", title: "T", source: { url: "u", retrievedAt: "2026-01-01", fingerprint: "f" }, generator: { name: "mdflow", version: "0.1.0", extractor: "defuddle", extractorVersion: "0.19.4" }, sections: [] };
  const markdown = "# T\n";
  const snapshot = { retrievedAt: "2026-01-01", fingerprint: "f" };
  const okRun = async () => ({ doc, markdown, snapshot });
  const failRun = async () => { throw new Error("upstream down"); };
  const req = (q = "https://example.com", headers) => new Request(`https://m/?url=${q}`, headers ? { headers } : undefined);

  record("agent-surface", "cache-key", "versioned",
    cacheKey("https://e.com", "0.1.0", "0.19.4") !== cacheKey("https://e.com", "0.1.0", "0.20.0"));

  const r6 = await handle(new Request("https://m/"), {}, { run: okRun, kv: makeKv() });
  record("agent-surface", "boundary", "400", r6.status === 400);

  const r7 = await handle(req("https://example.com", { accept: "application/json" }), {}, { run: okRun, kv: makeKv() });
  const r7body = await r7.text();
  record("agent-surface", "boundary", "json-content-type", r7.headers.get("content-type") === "application/json" && JSON.parse(r7body).schema === "mdflow/ir/v1");

  const r8 = await handle(req("http://127.0.0.1/"), {}, { run: okRun, kv: makeKv() });
  record("agent-surface", "boundary", "ssrf-block", r8.status === 400);
  const r8b = await handle(req("http://[::1]/"), {}, { run: okRun, kv: makeKv() });
  record("agent-surface", "boundary", "ssrf-ipv6", r8b.status === 400);

  const r9 = await handle(new Request("https://m/?url=https://example.com&format=json"), {}, { run: failRun, kv: makeKv() });
  const r9body = await r9.text();
  record("agent-surface", "boundary", "json-error", r9.headers.get("content-type") === "application/json" && JSON.parse(r9body).code === 502);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.kind}  ${r.text}`);

// Truth scores. Loss P/R is over headings, code, and tables only: prose is not audited.
// Known FPs and misses count against P/R; the baseline only stops them failing the gate.
const sum = { tp: 0, fp: 0, miss: 0, lost: 0, ntp: 0, nfp: 0, nmiss: 0 };
console.log("\nfixture                          loss P   R     (tp/fp/miss)   nav P   R     (tp/fp/miss)");
for (const { id, nav, loss } of truth) {
  sum.ntp += nav.tp; sum.nfp += nav.fp.length; sum.nmiss += nav.miss.length;
  const l = loss ? `${pr(loss.tp, loss.tp + loss.fp).padEnd(5)} ${pr(loss.tp, loss.lost).padEnd(5)} ${`${loss.tp}/${loss.fp}/${loss.miss}`.padEnd(14)}` : "(not audited)".padEnd(26);
  if (loss) { sum.tp += loss.tp; sum.fp += loss.fp; sum.miss += loss.miss; sum.lost += loss.lost; }
  console.log(`${id.padEnd(32)} ${l} ${pr(nav.tp, nav.tp + nav.fp.length).padEnd(5)} ${pr(nav.tp, nav.tp + nav.miss.length).padEnd(5)} ${nav.tp}/${nav.fp.length}/${nav.miss.length}`);
}
console.log(`${"all".padEnd(32)} ${pr(sum.tp, sum.tp + sum.fp).padEnd(5)} ${pr(sum.tp, sum.lost).padEnd(5)} ${`${sum.tp}/${sum.fp}/${sum.miss}`.padEnd(14)} ${pr(sum.ntp, sum.ntp + sum.nfp).padEnd(5)} ${pr(sum.ntp, sum.ntp + sum.nmiss).padEnd(5)} ${sum.ntp}/${sum.nfp}/${sum.nmiss}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed (wired, not verified)`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
