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
import { walk, validate, SCHEMA } from "./ir.js";
import { renderMarkdown } from "./render.js";
import { scoreLoss, scoreNav } from "./truth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(await readFile(join(ROOT, "test/inventory.json"), "utf8"));
const FIXED = "2026-01-01T00:00:00.000Z";

const blocks = (doc) => [...walk(doc)].map(({ block }) => block);
const results = [];
const record = (id, kind, text, ok) => results.push({ id, kind, text, ok });

// Serve frozen pages by URL; any other URL fails like a dead link.
const snap = (u, html) => ({ url: u, finalUrl: u, status: 200, contentType: "text/html", bytes: Buffer.byteLength(html), html, fingerprint: "f", retrievedAt: FIXED });
const pagesFetch = (pages) => async (u) => {
  if (u in pages) return snap(u, pages[u]);
  throw new Error(`no fixture: ${u}`);
};
const findSection = (doc, u) => {
  const rec = (s) => {
    if (s.url === u) return s;
    for (const c of s.children) { const f = rec(c); if (f) return f; }
    return null;
  };
  for (const s of doc.sections) { const f = rec(s); if (f) return f; }
  return null;
};

const truth = [];
const pr = (n, d) => (d ? (n / d).toFixed(2) : "-");
for (const [id, spec] of Object.entries(inventory)) {
  const html = await readFile(join(ROOT, "test/fixtures", spec.fixture), "utf8");
  record(id, "fixture", "sha256", createHash("sha256").update(html).digest("hex") === spec.sha256);
  const { doc } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "schema", SCHEMA, doc.schema === SCHEMA);

  // A pinned snapshot is one page; nav it does not follow is reported, never an empty section.
  const empty = [...(function* all(ss) { for (const s of ss) { yield s; yield* all(s.children); } })(doc.sections)].filter((s) => !s.blocks.length && !s.children.length);
  record(id, "scope", "page, siblings unfetched or absent, no empty section",
    doc.scope.kind === "page" && ["prev", "next"].every((r) => ["unfetched", "absent"].includes(doc.scope.siblings[r].status)) && !empty.length);

  const nav = scoreNav(html, spec.url, spec.nav);
  for (const f of nav.fp) record(id, "nav", `wrong sibling ${f}`, false);
  // Nav misses are baselined like loss misses: a new one fails, a stale entry fails.
  const knownNav = spec.known_nav_miss || [];
  for (const m of nav.miss) if (!knownNav.includes(m.split(":")[0])) record(id, "nav", `new miss ${m}`, false);
  for (const r of knownNav) if (!nav.miss.some((m) => m.startsWith(`${r}:`))) record(id, "nav", `known_nav_miss ${r} is stale: remove it`, false);
  const loss = scoreLoss(html, doc, spec);
  for (const e of loss.errors) record(id, "truth", e, false);
  if (!loss.errors.length) record(id, "truth", "labels resolve; findings match baseline", true);
  truth.push({ id, nav, loss: loss.counts, flat: loss.flat });

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
  record("truth-harness", "fails on", "known_fp without why", fails(withLosses(false, "Kept"), { known_fp: [H("Kept")] }, /without a why/));
  record("truth-harness", "fails on", "flattened label not emitted", fails(doc, { flattened: true }, /not emitted/));
  const demotedFinding = { ...doc, sections: [{ ...page, blocks: page.blocks.filter((b) => b.text !== "Gone"), losses: [{ type: "loss", reason: "r", source: "source-heading-demoted", text: "Gone" }] }] };
  record("truth-harness", "fails on", "demoted finding on a lost block", fails(demotedFinding, lost, /^new false positive \(lost\)/));
  record("truth-harness", "fails on", "demoted label whose text is gone", fails(withLosses(true), { labels: { demoted: [H("Gone")] } }, /labelled demoted but text not in IR/));
  record("truth-harness", "fails on", "lost label on a block in the IR", fails(doc, lost, /labelled lost but in IR/));
  // Partial layout loss: one line's relative indent gone, everything else intact.
  const py = "<html><body><main><h1>T</h1><pre>if x:\n    y = 1\n    z = 2</pre></main></body></html>";
  const pyDoc = await run({ url, html: py, retrievedAt: FIXED });
  const pyCut = structuredClone(pyDoc.doc);
  pyCut.sections[0].blocks = pyCut.sections[0].blocks.map((b) => (b.type === "code" ? { ...b, code: "if x:\n    y = 1\nz = 2" } : b));
  record("truth-harness", "fails on", "one line's indent lost",
    scoreLoss(py, pyDoc.doc, {}).errors.length === 0 && scoreLoss(py, pyCut, {}).errors.some((e) => e.startsWith("code layout changed")));
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
  const cut = base.filter((b) => b.type === "code" && b.code.includes(anchor));
  const losses = auditSourceLoss(html, base.filter((b) => !cut.includes(b)), "Ownership Rules");
  const flat = (t) => t.replace(/\s/g, "");
  const diffs = losses.filter((l) => l.source === "source-code-diff");
  record("mutation", "loss", `every removed block flagged as a diff (${cut.length})`,
    cut.length > 1 && diffs.length === cut.length && cut.every((b) => diffs.some((l) => flat(l.text) === flat(b.code))));
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

  // Code flattened into prose in its own section is demoted; the same text in another section,
  // or code under the length floor, is a diff.
  const long = "const answer = compute(41) + 1;";
  const code = auditSourceLoss(`<main><h2>A</h2><pre>${long}</pre><pre>ls -la</pre><h2>B</h2><pre>${long.replace("41", "40")}</pre><h2>C</h2></main>`,
    [Hd("A"), P(`Run \`${long}\` then ls -la`), Hd("B"), Hd("C"), P(long.replace("41", "40"))]);
  record("loss-audit", "demoted", "code in prose, same section only",
    JSON.stringify(src(code)) === JSON.stringify(["source-code-demoted", "source-code-diff", "source-code-diff"]));
  // Claim set: one paragraph absorbs one demoted copy; code the source already quotes in prose
  // is lost when its block drops, demoted only when the IR holds an extra copy.
  const twice = auditSourceLoss(`<main><h2>A</h2><pre>${long}</pre><pre>${long}</pre><h2>B</h2></main>`, [Hd("A"), P(`Run ${long}`), Hd("B")]);
  const quoted = `<main><h2>A</h2><p>Run ${long} now</p><pre>${long}</pre><h2>B</h2></main>`;
  record("loss-audit", "demoted", "code claim set: one copy per prose occurrence, source prose excluded",
    JSON.stringify(src(twice)) === JSON.stringify(["source-code-demoted", "source-code-diff"]) &&
    JSON.stringify(src(auditSourceLoss(quoted, [Hd("A"), P(`Run ${long} now`), Hd("B")]))) === JSON.stringify(["source-code-diff"]) &&
    JSON.stringify(src(auditSourceLoss(quoted, [Hd("A"), P(`Run ${long} now`), P(long), Hd("B")]))) === JSON.stringify(["source-code-demoted"]));

  // Flattened page: one doc-level finding; blocks whose text survives are demoted wherever
  // they sit, a block whose text is gone stays a diff.
  const flatSrc = "<main>" + ["One", "Two", "Three", "Four", "Five"].map((h) => `<h2>${h} heading</h2><p>x</p>`).join("") + "</main>";
  const flat = auditSourceLoss(flatSrc, [P("One heading x Two heading x Three heading x Four heading x")]);
  record("loss-audit", "flattened", "doc finding, survivors demoted, absent block a diff",
    JSON.stringify(src(flat)) === JSON.stringify(["extract-flattened", ...Array(4).fill("source-heading-demoted"), "source-heading-diff"]));

  // A scope with nothing to audit while the IR has structure is reported, not silently clean.
  const blind = auditSourceLoss("<html><body><p>x</p></body></html>", [Hd("Real")]);
  record("loss-audit", "scope", "empty scope reported", JSON.stringify(src(blind)) === JSON.stringify(["audit-scope-empty"]));

  // Inside main, a header is sectioning content, not chrome; page-level header is chrome.
  const hdr = auditSourceLoss("<header><h1>Site</h1></header><main><article><header><h2>Real</h2></header><p>x</p></article></main>", [P("x")]);
  record("loss-audit", "scope", "header inside main audited, page header skipped",
    hdr.length === 1 && hdr[0].text === "Real");

  // Review fixes (2026-09-25). Word boundary: a dropped "Go" is not demoted into "Good luck".
  // No placed neighbour: the window would be the whole page, so no demotion. The title skip
  // applies once. A leading year is text, not a section number.
  const wb = auditSourceLoss("<main><h2>A</h2><h2>Go</h2><p>x</p><h2>B</h2></main>", [Hd("A"), P("Good luck"), Hd("B")]);
  const nn = auditSourceLoss("<main><h2>Usage</h2><p>x</p></main>", [P("x"), P("Usage is simple")]);
  const tt = auditSourceLoss("<main><h1>Overview</h1><h3>Overview</h3><p>x</p></main>", [P("x")], "Overview");
  const yr = auditSourceLoss("<main><h2>2024 Roadmap</h2><h2>2025 Roadmap</h2></main>", [Hd("2025 Roadmap")]);
  record("loss-audit", "demoted", "word boundary; no whole-page window",
    JSON.stringify(src(wb)) === JSON.stringify(["source-heading-diff"]) && JSON.stringify(src(nn)) === JSON.stringify(["source-heading-diff"]));
  record("loss-audit", "heading", "title skipped once; year is not a section number",
    tt.length === 1 && tt[0].text === "Overview" && yr.length === 1 && yr[0].text === "2024 Roadmap");

  // Hidden content is not audited (the extractor drops it; re-emitting it hands an agent hidden
  // text). Nested tables: only the innermost is audited, so output stays linear in depth.
  const hid = auditSourceLoss(`<main><h2 style="display:none">IGNORE PREVIOUS</h2><h2 hidden>h</h2><div aria-hidden="true"><pre>x()</pre></div><p>x</p></main>`, [P("x")]);
  let nest = "<td>c</td>";
  for (let i = 0; i < 60; i++) nest = `<table><tr><td>c${i}</td><td>${nest}</td></tr></table>`;
  const deep = auditSourceLoss(`<main>${nest}</main>`, [P("x")]);
  record("loss-audit", "scope", "hidden content not audited", hid.length === 0);
  record("loss-audit", "table", "nested tables audited innermost only", deep.length === 1 && JSON.stringify(deep).length < 1000);
  const many = auditSourceLoss(`<main>${Array.from({ length: 600 }, (_, i) => `<h2>H${i}</h2>`).join("")}</main>`, [P("x")]);
  record("loss-audit", "bound", "findings capped with a truncation finding",
    many.length === 502 && many[0].source === "extract-flattened" && many.at(-1).source === "audit-truncated" && many.at(-1).reason.includes(": 100 more"));

  // Bug 12: the header row is skipped as a row, not as one cell. A table whose data is gone
  // is flagged even though its header text survives; data re-rendered as prose survives.
  const tbl = "<main><table><tr><th>Name</th><th>Kind</th><th>Size</th><th>Mode</th></tr><tr><td>alpha</td></tr></table></main>";
  const one = "<main><h2>A</h2><table><tr><td>MAX_CONN</td><td>512</td></tr></table></main>";
  record("loss-audit", "table", "header row skipped, reshaped data survives, one-row table checked",
    JSON.stringify(src(auditSourceLoss(tbl, [P("Name Kind Size Mode")]))) === JSON.stringify(["source-table-diff"]) &&
    auditSourceLoss(tbl, [P("alpha")]).length === 0 &&
    JSON.stringify(src(auditSourceLoss(one, [Hd("A")]))) === JSON.stringify(["source-table-diff"]));

  // Bug 15: a site-suffixed title that repeats the first heading is not rendered twice.
  const suffixed = renderMarkdown({ scope: { kind: "page", siblings: { prev: { status: "absent" }, next: { status: "absent" } } },
    sections: [{ title: "What is Ownership? - The Rust Programming Language", blocks: [Hd("What Is Ownership?")], losses: [], children: [] }] });
  record("render", "title", "site-suffixed title deduped", suffixed === "## What Is Ownership?\n");

  // Bug 13: a figcaption next to an image is kept.
  const fig = contentToBlocks('<figure><img src="a.png" alt="A"><figcaption>Figure caption</figcaption></figure>');
  record("to-ir", "figure", "figcaption kept with image", fig.length === 2 && fig[1].text === "Figure caption");
}

// Document-unit round-trip: a live run over frozen pages follows rel=next through the injected
// fetch; the sibling's blocks equal its own single-page run, order is page < next, the dead
// prev is a status in doc.scope (not a stub section), and the composed document is
// deterministic.
{
  const introUrl = "https://docs.python.org/3/tutorial/introduction.html";
  const cfUrl = "https://docs.python.org/3/tutorial/controlflow.html";
  const fetch = pagesFetch({
    [introUrl]: await readFile(join(ROOT, "test/fixtures/python-tutorial-intro.html"), "utf8"),
    [cfUrl]: await readFile(join(ROOT, "test/fixtures/python-tutorial-controlflow.html"), "utf8"),
  });
  const composed = await run({ url: introUrl, fetch, retrievedAt: FIXED });
  const secs = composed.doc.sections;
  const { scope } = composed.doc;
  record("document-unit", "order", "page < next, dead prev only in scope",
    secs.length === 2 && secs[0].url === introUrl && secs[1].url === cfUrl && scope.kind === "window" &&
    scope.siblings.prev.status === "failed" && scope.siblings.prev.url.endsWith("interpreter.html") && scope.siblings.next.status === "attached");
  record("document-unit", "render", "scope line first",
    composed.markdown.startsWith("> **Scope:** a prev/next window onto the section, not the whole section (prev: failed, next: attached)"));

  const cfSingle = await run({ url: cfUrl, fetch, retrievedAt: FIXED });
  const next = findSection(composed.doc, cfUrl);
  record("document-unit", "round-trip", "sibling blocks equal single-page run",
    !!next && next.blocks.length > 0 && JSON.stringify(next.blocks) === JSON.stringify(findSection(cfSingle.doc, cfUrl).blocks));

  const again = await run({ url: introUrl, fetch, retrievedAt: FIXED });
  record("document-unit", "determinism", "", JSON.stringify(composed.doc) === JSON.stringify(again.doc));
}

// Document-unit integrity: the compose/to-ir bugs that would ship broken sibling content.
// 9: direct text nodes in containers must survive. 10: a breadcrumb crumb linking to the
// page must not drop prev/next. 11: a nav href differing only by host casing canonicalizes to
// the fetched sibling. Ambiguous rel (two targets) attaches nothing.
{
  const textOf = (s) => (s?.blocks || []).map((b) => b.text || "").join(" ");
  const url = "https://example.com/docs/page/";
  const prevUrl = "https://example.com/docs/prev/", nextUrl = "https://example.com/docs/next/";
  const sib = {
    [prevUrl]: "<html><body><main><h1>Prev</h1><p>Prev content.</p></main></body></html>",
    [nextUrl]: "<html><body><main><h1>Next</h1><p>Next content.</p></main></body></html>",
  };
  const page = (head, body = "") => `<html><head>${head}</head><body>${body}<main><h1>Page</h1><p>Page content.</p></main></body></html>`;

  // 10: breadcrumb crumb linking to the page itself.
  {
    const html = page('<link rel="prev" href="/docs/prev/"><link rel="next" href="/docs/next/">',
      '<nav aria-label="breadcrumb"><a href="/docs/">Docs</a> <a href="/docs/page/">Page</a></nav>');
    const { doc } = await run({ url, fetch: pagesFetch({ [url]: html, ...sib }), retrievedAt: FIXED });
    record("document-unit", "integrity", "breadcrumb page-url keeps prev/next",
      textOf(findSection(doc, prevUrl)).includes("Prev content") && textOf(findSection(doc, nextUrl)).includes("Next content"));
    record("document-unit", "breadcrumbs", "trail in doc.breadcrumbs, self excluded, not sections",
      JSON.stringify(doc.breadcrumbs) === JSON.stringify([{ title: "Docs", url: "https://example.com/docs/" }]) && doc.sections.length === 3);
    const up = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="up" href="/docs/" title="Docs">') }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "rel=up without a trail", up.doc.breadcrumbs.length === 1 && up.doc.breadcrumbs[0].url === "https://example.com/docs/" && up.doc.sections.length === 1);
  }

  // 11: an upper-cased host in the nav href still reaches the sibling.
  {
    const html = page('<link rel="next" href="https://EXAMPLE.com/docs/next/">');
    const { doc } = await run({ url, fetch: pagesFetch({ [url]: html, ...sib }), retrievedAt: FIXED });
    record("document-unit", "integrity", "host-cased nav href attaches content", textOf(findSection(doc, nextUrl)).includes("Next content"));
  }

  // rel is a token list on <a> too; two different next targets attach neither.
  {
    const tok = await run({ url, fetch: pagesFetch({ [url]: page("", '<a rel="next prefetch" href="/docs/next/">Next</a>'), ...sib }), retrievedAt: FIXED });
    record("document-unit", "nav", "rel token on <a> attaches", textOf(findSection(tok.doc, nextUrl)).includes("Next content"));
    const two = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next" href="/docs/next/">', '<a rel="next" href="/docs/other/">x</a>'), ...sib }), retrievedAt: FIXED });
    record("document-unit", "nav", "ambiguous rel attaches nothing", two.doc.sections.length === 1);
    const js = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next" href="javascript:alert(1)"><link rel="prev" href="file:///etc/passwd">') }), retrievedAt: FIXED });
    record("document-unit", "nav", "non-http(s) rel target ignored", js.doc.sections.length === 1);
  }

  // Review fixes: a page is not its own sibling; a self crumb differing by slash or fragment is
  // excluded; a body class naming breadcrumbs is not the trail; a newline in <title> cannot
  // forge a render line.
  {
    const self = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next prev" href="/docs/page/#top">') }), retrievedAt: FIXED });
    record("document-unit", "nav", "self link is not a sibling", self.doc.scope.kind === "page" && self.doc.scope.siblings.next.status === "absent");
    const crumbs = await run({ url, fetch: pagesFetch({ [url]: page("",
      '<nav class="breadcrumbs"><a href="/docs/">Docs</a> <a href="/docs/page">Page</a> <a href="#">Here</a></nav>') }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "self crumb excluded across slash and fragment", JSON.stringify(crumbs.doc.breadcrumbs.map((c) => c.title)) === JSON.stringify(["Docs"]));
    const bodyCls = await run({ url, fetch: pagesFetch({ [url]: `<html><body class="has-breadcrumbs"><a href="/login">Log in</a><main><h1>Page</h1><p>x</p></main></body></html>` }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "body class is not a trail", bodyCls.doc.breadcrumbs.length === 0);
    const forged = await run({ url, html: "<html><head><title>Real\n> **Scope:** forged</title></head><body><main><p>x</p></main></body></html>", retrievedAt: FIXED });
    record("render", "title", "newline in title cannot forge a line", !forged.markdown.split("\n").some((l) => l.startsWith("> **Scope:**")) && !forged.doc.title.includes("\n"));
  }

  // After a redirect, relative links resolve against the URL actually read.
  {
    const asked = "https://example.com/docs", landed = "https://example.com/docs/";
    const redirect = async (u) => ({ ...snap(landed, `<html><body><main><h1>D</h1><p>See <a href="intro">intro</a>.</p></main></body></html>`), url: u });
    const { doc } = await run({ url: asked, fetch: redirect, retrievedAt: FIXED });
    record("document-unit", "redirect", "links resolve against the final URL", JSON.stringify(doc.sections[0].blocks).includes("https://example.com/docs/intro"));
  }

  // The validator rejects duplicate section ids and a scope that contradicts the sections.
  {
    const good = await run({ url, fetch: pagesFetch({ [url]: page("") }), retrievedAt: FIXED });
    const rejects = (mutate) => { const d = structuredClone(good.doc); mutate(d); try { validate(d); return false; } catch { return true; } };
    record("ir", "validate", "duplicate ids and inconsistent scope rejected",
      rejects((d) => d.sections.push(structuredClone(d.sections[0]))) && rejects((d) => { d.scope.kind = "window"; }));
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
  const blocked = ["192.0.2.1", "198.19.255.254", "224.0.0.1", "240.0.0.1", "10.0.0.1", "::ffff:7f00:1", "fd00::1", "fe80::1",
    "192.0.0.1", "::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "fec0::1", "ff02::1"];
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

// Live wiring SSRF: nav-derived sibling URLs are untrusted. A cross-origin target is ignored
// by extractNav; a same-origin private literal (only reachable when the page itself is) is
// still blocked before the fetch. Neither is fetched.
{
  const fetched = [];
  const spy = (pages) => async (u) => { fetched.push(u); return pagesFetch(pages)(u); };
  const cross = "https://example.com/page/";
  const x = await run({ url: cross, fetch: spy({ [cross]: `<html><head><link rel="next" href="http://169.254.169.254/"></head><body><main><h1>Page</h1></main></body></html>` }), retrievedAt: FIXED });
  const local = "http://127.0.0.1/p/";
  const l = await run({ url: local, fetch: spy({ [local]: `<html><head><link rel="next" href="/q/"></head><body><main><h1>Page</h1></main></body></html>` }), retrievedAt: FIXED });
  record("wiring", "ssrf", "cross-origin sibling ignored, private sibling blocked, neither fetched",
    JSON.stringify(fetched) === JSON.stringify([cross, local]) && x.doc.scope.siblings.next.status === "absent" &&
    l.doc.scope.siblings.next.status === "blocked" && l.doc.sections.length === 1);
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
const sum = { tp: 0, fp: 0, miss: 0, lost: 0, ntp: 0, nfp: 0, nmiss: 0, ftp: 0, ffp: 0, fmiss: 0 };
console.log("\nfixture                          loss P   R     (tp/fp/miss)   nav P   R     (tp/fp/miss)");
for (const { id, nav, loss, flat } of truth) {
  sum.ntp += nav.tp; sum.nfp += nav.fp.length; sum.nmiss += nav.miss.length;
  sum.tp += loss.tp; sum.fp += loss.fp; sum.miss += loss.miss; sum.lost += loss.lost;
  if (flat.emitted && flat.labelled) sum.ftp++; else if (flat.emitted) sum.ffp++; else if (flat.labelled) sum.fmiss++;
  const l = `${pr(loss.tp, loss.tp + loss.fp).padEnd(5)} ${pr(loss.tp, loss.lost).padEnd(5)} ${`${loss.tp}/${loss.fp}/${loss.miss}`.padEnd(14)}`;
  console.log(`${id.padEnd(32)} ${l} ${pr(nav.tp, nav.tp + nav.fp.length).padEnd(5)} ${pr(nav.tp, nav.tp + nav.miss.length).padEnd(5)} ${nav.tp}/${nav.fp.length}/${nav.miss.length}`);
}
console.log(`${"all".padEnd(32)} ${pr(sum.tp, sum.tp + sum.fp).padEnd(5)} ${pr(sum.tp, sum.lost).padEnd(5)} ${`${sum.tp}/${sum.fp}/${sum.miss}`.padEnd(14)} ${pr(sum.ntp, sum.ntp + sum.nfp).padEnd(5)} ${pr(sum.ntp, sum.ntp + sum.nmiss).padEnd(5)} ${sum.ntp}/${sum.nfp}/${sum.nmiss}`);
console.log(`${"page: extract-flattened".padEnd(32)} tp/fp/miss ${sum.ftp}/${sum.ffp}/${sum.fmiss}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed (wired, not verified)`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
