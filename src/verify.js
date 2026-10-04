// The gate: scores the loss audit and nav detection against hand-labelled truth
// (test/inventory.json, via src/truth.js), fails on any false positive, miss, code drift, or
// structure diff not named in the fixture's known_* baseline, and checks wiring, mutation, SSRF,
// and the CLI boundary. Determinism compares a pure function to itself (near-tautological). Exit 1 on any
// failure.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { run } from "./pipeline.js";
import { auditSourceLoss, restoreCodeLayout } from "./loss-audit.js";
import { contentToBlocks } from "./to-ir.js";
import { decompress, fetchSnapshot, MAX_BYTES } from "./fetch.js";
import { isPrivateIp } from "./ssrf.js";
import { walk, validate, SCHEMA, BLOCK_TYPES } from "./ir.js";
import { renderMarkdown, NOTE_SOURCES, REASON_IS_MDFLOW } from "./render.js";
import { marked } from "marked";
import { useEntry, USE_KEYS, ERROR_KEYS } from "./uselog.js";
import { unescape } from "./md.js";
import { extractNav } from "./compose.js";
import { parseHtml } from "./html.js";
import { scoreLoss, scoreNav } from "./truth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The CLI runs verify spawns must not write to the developer's dogfood log.
delete process.env.MDFLOW_LOG;
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

// The render, lexed by a CommonMark parser mdflow did not write (marked, a pinned devDependency):
// page text must form no block the IR lacks. Below the header, the blocks are exactly the IR's:
// one heading per section title and IR heading plus the notes heading (last, with the header's
// fingerprint, which page text cannot know); code blocks are the IR's code and the notes' fences,
// verbatim and in order; one paragraph per IR paragraph, image, and note label; tables, lists,
// and quotes as in the IR; no HTML but <br>, no rule, no link definition.
function oracle(doc, md) {
  const bad = [];
  const lines = md.split("\n");
  const tokens = marked.lexer(lines.slice(lines.indexOf("---", 1) + 1).join("\n"));
  const of = (t) => tokens.filter((k) => k.type === t);
  const sections = [...(function* all(ss) { for (const s of ss) { yield s; yield* all(s.children); } })(doc.sections)];
  const blocks = [...walk(doc)].map(({ block }) => block);
  const ir = (t) => blocks.filter((b) => b.type === t);
  const losses = sections.flatMap((s) => s.losses);
  const n = losses.length;
  const same = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: got ${JSON.stringify(got).slice(0, 120)}, want ${JSON.stringify(want).slice(0, 120)}`); };
  for (const k of tokens) if (!["heading", "paragraph", "code", "table", "list", "blockquote", "space"].includes(k.type)) bad.push(`block ${k.type}: ${String(k.raw).slice(0, 60)}`);
  same("headings", of("heading").length, sections.length + ir("heading").length + (n ? 1 : 0));
  if (n) same("notes heading", of("heading").at(-1)?.text, `mdflow: ${n} loss${n === 1 ? "" : "es"} (fingerprint ${doc.source.fingerprint})`);
  same("code", of("code").map((k) => k.text), [...ir("code").map((b) => b.code), ...losses.filter((l) => !REASON_IS_MDFLOW.has(l.source)).map((l) => l.text ?? "")]);
  same("paragraphs", of("paragraph").length, ir("paragraph").length + ir("image").length + n);
  // Cells by text, not count: a cell split by a page | keeps the count (marked drops extras).
  const cellText = (t) => unescape(t).replace(/\s+/g, " ").trim();
  same("tables", of("table").map((k) => [k.header.map((c) => cellText(c.text)), k.rows.map((r) => r.map((c) => cellText(c.text)))]),
    ir("table").filter((t) => t.headers.length).map((t) => [t.headers.map(cellText), t.rows.map((r) => r.map(cellText))]));
  same("lists", of("list").map((k) => k.items.length), ir("list").map((l) => l.items.length));
  same("quotes", of("blockquote").length, ir("blockquote").length);
  for (const l of losses.filter((x) => REASON_IS_MDFLOW.has(x.source))) if (!md.includes(`${l.source}: ${l.reason}\n`)) bad.push(`note reason missing: ${l.source}`);
  const inline = (ks) => { for (const k of ks ?? []) { if (k.type === "html" && k.text !== "<br>") bad.push(`inline html: ${k.text.slice(0, 60)}`); inline(k.tokens); for (const it of k.items ?? []) inline(it.tokens); for (const c of [...(k.header ?? []), ...(k.rows ?? []).flat()]) inline(c.tokens); } };
  inline(tokens);
  return bad;
}
// The header: front matter of mdflow's fields only, each once, URL values as the parser
// serializes them.
const HEADER_KEYS = ["warning", "mdflow", "source", "final", "retrieved", "fingerprint", "prev", "next", "up", "losses", "content"];
const URL_KEYS = new Set(["source", "final", "prev", "next", "up"]);
const headerOk = (md) => {
  const lines = md.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) return false;
  const keys = [];
  for (const l of lines.slice(1, end)) {
    const m = l.match(/^([a-z]+): (\S.*)$/);
    if (!m || !HEADER_KEYS.includes(m[1]) || keys.includes(m[1])) return false;
    keys.push(m[1]);
    if (URL_KEYS.has(m[1]) && !m[2].split(" ").every((u) => { try { return new URL(u).href === u; } catch { return false; } })) return false;
  }
  return keys.join() === HEADER_KEYS.filter((k) => keys.includes(k)).join();
};
const renderOk = (doc, md) => headerOk(md) && !oracle(doc, md).length;

const truth = [];
const fixtureDocs = new Map();
const pr = (n, d) => (d ? (n / d).toFixed(2) : "-");
for (const [id, spec] of Object.entries(inventory)) {
  const html = await readFile(join(ROOT, "test/fixtures", spec.fixture), "utf8");
  record(id, "fixture", "sha256", createHash("sha256").update(html).digest("hex") === spec.sha256);
  const { doc, markdown } = await run({ url: spec.url, html, retrievedAt: FIXED });
  fixtureDocs.set(id, doc);
  record(id, "schema", SCHEMA, doc.schema === SCHEMA);
  const why = headerOk(markdown) ? oracle(doc, markdown) : ["header"];
  record(id, "render", why.length ? `render: ${why.join("; ")}` : "header, blocks as the IR, every loss noted", !why.length);
  // Shape invariants the truth scorer cannot see: it shares the parser, and scores no prose.
  record(id, "parse", "no row or table section inside a cell", !parseHtml(html).document.querySelector(":is(th, td) > :is(tr, thead, tbody, tfoot)"));
  record(id, "prose", "no punctuation-only paragraph", !blocks(doc).some((b) => b.type === "paragraph" && /^[\p{P}\s]+$/u.test(b.text)));

  // One page, one section; nav it records is never an empty section.
  const empty = [...(function* all(ss) { for (const s of ss) { yield s; yield* all(s.children); } })(doc.sections)].filter((s) => !s.blocks.length && !s.children.length);
  record(id, "scope", "page, one section, no empty section", doc.scope.kind === "page" && doc.sections.length === 1 && !empty.length);

  const nav = scoreNav(html, spec.url, spec.nav);
  for (const f of nav.fp) record(id, "nav", `wrong nav target ${f}`, false);
  // Nav misses are baselined like loss misses: a new one fails, a stale entry fails.
  const knownNav = spec.known_nav_miss || [];
  for (const m of nav.miss) if (!knownNav.includes(m.split(":")[0])) record(id, "nav", `new miss ${m}`, false);
  for (const r of knownNav) if (!nav.miss.some((m) => m.startsWith(`${r}:`))) record(id, "nav", `known_nav_miss ${r} is stale: remove it`, false);
  const loss = scoreLoss(html, doc, spec);
  for (const e of loss.errors) record(id, "truth", e, false);
  if (!loss.errors.length) record(id, "truth", "labels resolve; findings match baseline", true);
  truth.push({ id, nav, loss: loss.counts, flat: loss.flat, structure: loss.structure });

  // Determinism: same snapshot + pinned retrievedAt -> byte-identical IR and Markdown.
  const { doc: again, markdown: mdAgain } = await run({ url: spec.url, html, retrievedAt: FIXED });
  record(id, "determinism", "", JSON.stringify(doc) === JSON.stringify(again) && markdown === mdAgain);
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
  record("truth-harness", "fails on", "demoted label on a block present as its type", fails(doc, { labels: { demoted: [H("Gone")] } }, /labelled demoted but present as heading/));
  // Two copies of one heading, chrome and demoted: the chrome copy in the IR is not the demoted
  // one. A stale demoted code label is reported as stale, not as layout drift.
  {
    const dup = "<html><body><main><h1>T</h1><h2>Dup</h2><p>x</p><h2>Dup</h2><p>y</p><pre>a\n  b</pre></main></body></html>";
    const para = (text) => ({ type: "paragraph", text });
    const ir = { ...doc, sections: [{ ...page, blocks: [{ type: "heading", level: 2, text: "Dup" }, para("x"), para("Dup"), para("y"), { type: "code", code: "a\nb" }], losses: [] }] };
    const errs = (labels) => scoreLoss(dup, ir, { labels }).errors;
    record("truth-harness", "passes on", "a chrome copy is not a stale demoted one; stale code reports no drift",
      !errs({ chrome: [H("Dup")], demoted: [H("Dup")] }).some((e) => /present as heading/.test(e)) &&
      errs({ chrome: [H("Dup")], demoted: [H("Dup"), { kind: "code", key: "a" }] }).some((e) => /present as code/.test(e)) &&
      !errs({ chrome: [H("Dup")], demoted: [H("Dup"), { kind: "code", key: "a" }] }).some((e) => /layout changed/.test(e)));
  }
  // Structure: a moved block, a changed level, and a block under a heading the source lacks each
  // fail; a known_structure entry that no longer fires is stale.
  const reshaped = (f) => ({ ...doc, sections: [{ ...page, blocks: f(page.blocks) }] });
  const codeFirst = reshaped((bs) => [...bs.filter((b) => b.type === "code"), ...bs.filter((b) => b.type !== "code")]);
  const leveled = reshaped((bs) => bs.map((b) => (b.text === "Kept" ? { ...b, level: 3 } : b)));
  const extra = reshaped((bs) => bs.flatMap((b) => (b.type === "code" ? [{ type: "heading", level: 3, text: "Extra" }, b] : [b])));
  record("truth-harness", "fails on", "structure: order, level, section, stale",
    fails(codeFirst, {}, /^structure changed \(order\)/) && fails(leveled, {}, /^structure changed \(level\)/) &&
    fails(extra, {}, /^structure changed \(section\)/) && errors(doc, {}).length === 0 &&
    fails(doc, { known_structure: [{ kind: "order", key: "Kept", why: "w" }] }, /stale/));
  // Truth reads a <pre> with bare text as a whole: an intact inline-code command is present.
  const cmd = "<html><body><main><h1>T</h1><pre>$ npm install <code>mdflow-package-name</code> --save-dev</pre></main></body></html>";
  record("truth-harness", "passes on", "bare pre text around inline code", scoreLoss(cmd, (await run({ url, html: cmd, retrievedAt: FIXED })).doc, {}).errors.length === 0);
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
  const C = (code) => ({ type: "code", code });

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

  // A glyph-only same-page anchor is a permalink, not heading text; a <pre>'s code is its <code>,
  // not its toolbar. "C#" keeps its glyph: it is text, not an anchor.
  const ui = auditSourceLoss(`<main><h2>Path<a class="mark" href="#path">#</a></h2><h2>C#</h2><pre><input type="checkbox"><code>${long}</code><div><span>javascript</span><button>copy</button></div></pre></main>`,
    [Hd("Path"), Hd("C#"), C(long)]);
  record("loss-audit", "identity", "permalink glyph and code toolbar are not block text", ui.length === 0);

  // A first line whose leading whitespace Defuddle trimmed is restored from the source; a block
  // that differs in any other way is left for the audit.
  const art = "<main><pre>  +--+\n  |a|\n  +--+</pre><pre>x = 1</pre></main>";
  const back = restoreCodeLayout(art, [C("+--+\n  |a|\n  +--+"), C("+--+\n |a|\n  +--+"), C("x = 1")]);
  record("loss-audit", "layout", "trimmed first line restored from source, other drift left",
    back[0].code === "  +--+\n  |a|\n  +--+" && back[1].code === "+--+\n |a|\n  +--+" && back[2].code === "x = 1");
  // Copies that share a trimmed text pair in order: the unindented one does not take the indent.
  const pair = restoreCodeLayout("<main><pre>x\n  y</pre><pre>  x\n  y</pre></main>", [C("x\n  y"), C("x\n  y")]);
  record("loss-audit", "layout", "same trimmed text restored by position", pair[0].code === "x\n  y" && pair[1].code === "  x\n  y");
  // A <pre> with bare text around an inline <code> is code as a whole.
  const inline = auditSourceLoss("<main><pre>$ npm install <code>mdflow-package-name</code> --save-dev</pre></main>", [C("$ npm install mdflow-package-name --save-dev")]);
  record("loss-audit", "identity", "bare pre text around inline code kept", inline.length === 0);

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


  // Blocks are separated by a blank line, so paragraphs and a list stay distinct in Markdown.
  const mk = (blocks, losses = []) => ({ schema: SCHEMA, id: "x", title: "T", source: { url: "https://example.com/t", finalUrl: "https://example.com/t", retrievedAt: FIXED, fingerprint: "f" },
    generator: { name: "mdflow", version: "0.0.0", extractor: "defuddle", extractorVersion: "0.19.4" }, scope: { kind: "page" }, breadcrumbs: [],
    sections: [{ id: "s", title: "T", blocks, losses, children: [] }] });
  const body = (md) => md.slice(md.indexOf("\n---\n", 3) + 5).replace(/^\n+/, "");
  const sep = renderMarkdown(mk([P("a"), P("b"), { type: "list", ordered: false, items: ["x"] }, P("c")]));
  record("render", "blocks", "header, then blank line between blocks", headerOk(sep) && body(sep) === "# T\n\na\n\nb\n\n- x\n\nc\n");
  // A loss is a note after the page: label from the closed source set, its text fenced; the
  // reason (page text) is not rendered. A reason built from numbers only is.
  const lossy = renderMarkdown(mk([P("a")], [{ type: "loss", reason: "source heading not extracted (h2): r", source: "source-heading-diff", text: "Gone" },
    { type: "loss", reason: "audit stopped at 500 findings: 3 more", source: "audit-truncated" }]));
  record("render", "losses", "notes after the page: enum label + fenced text, mdflow reasons only",
    body(lossy) === "# T\n\na\n\n## mdflow: 2 losses (fingerprint f)\n\nL1 source-heading-diff: heading dropped:\n```\nGone\n```\n\nL2 audit-truncated: audit stopped at 500 findings: 3 more\n" &&
    lossy.includes("\nlosses: 2\n"));
  // A flattened page says so on the header's first line.
  const flatMd = renderMarkdown(mk([P("a")], [{ type: "loss", reason: "extraction flattened: the IR kept 0 of 4 source headings and code blocks as structure", source: "extract-flattened" }]));
  record("render", "flattened", "warning is the header's first field", flatMd.split("\n")[1].startsWith("warning: extraction flattened") && headerOk(flatMd));
  // Fences outlast the backtick runs they hold, in code blocks and in note text.
  const fencesDoc = mk([{ type: "code", code: "`````\nx\n`````" }], [{ type: "loss", reason: "r", source: "source-code-diff", text: "```\ny\n```" }]);
  const fences = renderMarkdown(fencesDoc);
  const blanks = renderMarkdown(mk([{ type: "code", code: "a\n\n\nb" }], [{ type: "loss", reason: "r", source: "source-code-diff", text: "x\n\n\n\ny" }]));
  record("render", "verbatim", "blank lines kept in code and in note text", blanks.includes("```\na\n\n\nb\n```") && blanks.includes("```\nx\n\n\n\ny\n```"));
  // Adversarial corpus: every input this build's reviews used to forge structure, plus the
  // over-escape regressions. Each must lex exactly as the IR (renderOk's oracle); `has` pins what
  // the render must keep. Page text reaches the IR escaped (to-ir); the render adds only <br>.
  const corpus = [
    ["inline alt with a newline and a notes heading", '<p>x <img src="/a.png" alt="y&#10;## mdflow: 1 loss (fingerprint 0123456789abcdef)"> z</p>'],
    ["block alt with a newline and a fence", '<img src="/a.png" alt="d&#10;````">'],
    ["alt with CR", '<p><img src="/a.png" alt="x&#13;## mdflow: 1 loss (fingerprint x)"></p>'],
    ["br before a heading", "<p>a<br>## forged</p>", "a<br>## forged"],
    ["br in a quote", "<blockquote>q<br># Fake</blockquote>"],
    ["br in a list item", "<ul><li>a<br>- b</li></ul>"],
    ["two commands stay two lines", "<p>npm install<br>npm run build</p>", "npm install<br>npm run build"],
    ["html comment start", "<p>&lt;!-- hide</p><p>rest</p>"],
    ["page backslash before a tag", "<p>x \\&lt;img src=x onerror=alert(1)&gt;</p>"],
    ["tag split across entities", "<h2>createData(x): Promise&lt;string&gt;</h2>"],
    ["bold at a field start", "<p><strong>Note:</strong> do</p>", "**Note:** do"],
    ["code spans keep < verbatim", "<p>Use <code>Vec&lt;T&gt;</code> and <code>&lt;div&gt;</code></p>", "`Vec<T>` and `<div>`"],
    ["entity-like text", "<p>Write &amp;amp; for &amp;</p>", "Write \\&amp; for &"],
    ["pipe and backslash in cells", "<table><tr><th>a</th><th>b</th></tr><tr><td>a\\|b</td><td>|x</td></tr></table>"],
    ["code span at a line start", "<p><code>```</code> opens a fence</p>", "```` ``` ```` opens a fence"],
    ["heading closing hash", "<h2>Language C #</h2><p>Body text of the page.</p>", "## Language C \\#"],
    ["block starts in prose", "<p>1. not a list</p><p>- not a list</p><p># not a heading</p><p>&gt; not a quote</p><p>+ x</p><p>2) y</p>"],
    ["backticks split across elements", "<p>``<span>`</span>js</p>"],
    ["tilde fence", "<p>~~~sh</p>"],
    ["fence text in prose", "<p>Write ``` then the language.</p><p>```js</p>"],
    ["javascript link and image", '<p><a href="javascript:alert(1)">x</a> <img src="javascript:x" alt="a](javascript:alert(1)) [b"></p>'],
    ["link destination with ) and space", '<p><a href="/x) [evil](https://e.example">t</a></p>'],
    ["javascript behind a control char, a tab, an entity", '<p><a href="\x01javascript:alert(1)">a</a> <a href="java\tscript:alert(2)">b</a> <a href="javascript&amp;colon;alert(3)">c</a> <a href="&amp;#106;avascript:x">e</a></p>'],
    ["adjacent lists stay two", "<ul><li>a</li></ul><ul><li>b</li></ul><ol><li>c</li></ol><ol><li>d</li></ol>"],
    ["underscores", "<p>snake_case and _emph_ and __init__</p>", "snake_case"],
    ["emphasis characters", "<p>2 * 3 [x] ~y~ `z`</p>"],
  ];
  const corpusBad = [];
  for (const [name, body, has] of corpus) {
    const { doc, markdown } = await run({ url: "https://example.com/c", retrievedAt: FIXED, html: `<html><body><main><h1>C</h1>${body}</main></body></html>` });
    const why = headerOk(markdown) ? oracle(doc, markdown) : ["header"];
    const links = [];
    const walkTok = (ks) => { for (const k of ks ?? []) { if (k.type === "link" || k.type === "image") links.push(k.href); walkTok(k.tokens); for (const it of k.items ?? []) walkTok(it.tokens); } };
    walkTok(marked.lexer(markdown.split("\n").slice(markdown.split("\n").indexOf("---", 1) + 1).join("\n")));
    if (links.some((h) => !/^(https?:|mailto:)/.test(h))) why.push(`non-http link ${links.join(" ")}`);
    if (has && !markdown.includes(has)) why.push(`missing ${JSON.stringify(has)}`);
    if (why.length) corpusBad.push(`${name}: ${why.join("; ")}`);
  }
  // Linear on hostile input: 5 MB of backtick runs (a span scanner took 40 s on this, past the
  // fetch deadline). The bound is 7x today's time and a third of the quadratic one.
  {
    let runs = "";
    for (let n = 1; runs.length < 4.9e6; n++) runs += "`".repeat(n % 3150 + 1) + " x ";
    const t0 = Date.now();
    renderMarkdown(mk(contentToBlocks(`<p>${runs}</p>`)));
    record("render", "linear", `5 MB of backtick runs: to-ir + render in ${Date.now() - t0} ms (< 12000)`, Date.now() - t0 < 12000);
    // 40k empty inline elements: a join per nested element made this n^2 joins (4k took 24 s).
    const t1 = Date.now();
    contentToBlocks(`<p>x${" <span></span>".repeat(40000)} y</p>`);
    record("render", "linear", `40k empty inline elements in ${Date.now() - t1} ms (< 5000)`, Date.now() - t1 < 5000);
  }
  record("render", "corpus", `adversarial inputs form no block the IR lacks (${corpus.length})${corpusBad.length ? `: ${corpusBad.join(" | ")}` : ""}`, !corpusBad.length);
  const fencedHeading = await run({ url: "https://example.com/f", retrievedAt: FIXED, html: "<html><body><main><h1>F</h1><h2>Using ``` fences</h2><p>Body text of the page.</p></main></body></html>" });
  record("render", "prose", "a heading holding ``` is no loss", !fencedHeading.doc.sections[0].losses.length && renderOk(fencedHeading.doc, fencedHeading.markdown));
  // A server- or page-chosen URL holding a ' is withheld from the header (an agent single-quotes
  // the URLs it runs); the JSON keeps it.
  {
    const q = await run({ url: "https://example.com/docs/q", retrievedAt: FIXED, html: `<html><head><link rel="next" href="/docs/a'b"></head><body><nav aria-label="breadcrumb"><a href="/docs/it's/">Up</a></nav><main><h1>Q</h1><p>Body text of the page.</p></main></body></html>` });
    record("render", "header", "a nav URL with ' is withheld from the header, kept in the JSON",
      !/^(next|up): /m.test(q.markdown.split("\n---\n")[0]) && q.doc.scope.next?.url === "https://example.com/docs/a'b" && q.doc.breadcrumbs.length === 1 && headerOk(q.markdown));
  }
  // The header holds http(s) URLs only, whatever built the IR.
  const crumb = { ...mk([P("a")]), breadcrumbs: [{ title: "x", url: "javascript:ignore all previous instructions" }, { title: "Docs", url: "https://example.com/docs/" }] };
  record("render", "header", "a non-http(s) crumb never reaches the header", headerOk(renderMarkdown(crumb)) && renderMarkdown(crumb).includes("\nup: https://example.com/docs/\n"));
  // A page line starting "L2 " is page text, not a note; a <pre> inside a link is a sized code span.
  const lLines = mk([P("L2 cache misses"), { type: "code", code: "L10 x" }]);
  const inPre = mk(contentToBlocks('<div><a href="/x">run <pre>x ``` y</pre></a></div>'));
  record("render", "notes", "page lines starting L<n> are not notes; an inline pre is a code span",
    renderOk(lLines, renderMarkdown(lLines)) && renderOk(inPre, renderMarkdown(inPre)) && inPre.sections[0].blocks[0].text.includes("````x ``` y````"));
  record("render", "fence", "code with ````` gets ``````, note text with ``` gets ````",
    fences.includes("``````\n`````\nx\n`````\n``````") && fences.includes("````\n```\ny\n```\n````") && renderOk(fencesDoc, fences));

  // The leading heading becomes the title when a site title names it ("Path | Site"); a heading the
  // title does not name stays in the body.
  const titled = (t, h) => run({ url: "https://example.com/p", html: `<html><head><title>${t}</title></head><body><main><h2>${h}</h2><p>Body text for the page.</p></main></body></html>`, retrievedAt: FIXED });
  const [{ doc: named }, { doc: other }, { doc: brand }] = await Promise.all([titled("Path | Site Docs v2", "Path"), titled("Guide | Site", "Install"), titled("Getting Started | Acme", "Acme")]);
  record("pipeline", "title", "leading heading promoted only when the title's page part names it",
    named.title === "Path" && named.sections[0].blocks[0].type !== "heading" && !named.sections[0].losses.length &&
    other.sections[0].blocks[0].text === "Install" && brand.title !== "Acme" && brand.sections[0].blocks[0].text === "Acme");

  // Defuddle can wrap its content in <body> (tailwindcss.com): a container, not one paragraph.
  const wrapped = contentToBlocks("<body><h2>A</h2><p>x</p><pre><code>y</code></pre></body>");
  record("to-ir", "body", "a body wrapper is a container", JSON.stringify(wrapped.map((b) => b.type)) === '["heading","paragraph","code"]');

  // Bug 13: a figcaption next to an image is kept.
  const fig = contentToBlocks('<figure><img src="a.png" alt="A"><figcaption>Figure caption</figcaption></figure>');
  record("to-ir", "figure", "figcaption kept with image", fig.length === 2 && fig[1].text === "Figure caption");

  // Nested main landmarks (SQLAlchemy): the innermost is the content and the audit scope.
  const { doc: nested } = await run({ url: "https://example.com/n", retrievedAt: FIXED,
    html: "<html><head><title>Guide — Site Docs</title></head><body><main><p>Release: 2.0</p><div><ul><li><a href='/a'>A</a></li><li><a href='/b'>B</a></li></ul><h4>Project Versions</h4></div><div role='main'><h1>Guide</h1><p>The guide body text, long enough to be the content of this page.</p><pre><code>x = 1</code></pre></div></main></body></html>" });
  record("pipeline", "landmark", "nested main: innermost only, title promoted, chrome outside it not audited",
    nested.title === "Guide" && JSON.stringify(nested.sections[0].blocks.map((b) => b.type)) === '["paragraph","code"]' && !nested.sections[0].losses.length);

  // Optional end tags: htmlparser2 nests the tbody inside the open th (Playwright, nodejs).
  const { doc: opt } = await run({ url: "https://example.com/t", retrievedAt: FIXED,
    html: "<html><body><main><h2>Options</h2><table><thead><tr><th>Option<th>Description<tbody><tr><td><code>--a</code><td>First<tr><td>--b<td>Second<tfoot><tr><td>F<td>G</table><p>After the table.</p></main></body></html>" });
  const optTable = opt.sections[0].blocks.find((b) => b.type === "table");
  record("pipeline", "table", "optional end tags: header row alone, body rows as rows, nothing lost",
    JSON.stringify(optTable?.headers) === '["Option","Description"]' && JSON.stringify(optTable?.rows) === '[["--a","First"],["--b","Second"],["F","G"]]' && !opt.sections[0].losses.length);
}

// Nav is recorded, not fetched: a live run over frozen pages reads only the page, records its
// rel=prev/next targets in doc.scope, and is deterministic.
{
  const introUrl = "https://docs.python.org/3/tutorial/introduction.html";
  const cfUrl = "https://docs.python.org/3/tutorial/controlflow.html";
  const fetched = [];
  const pages = pagesFetch({
    [introUrl]: await readFile(join(ROOT, "test/fixtures/python-tutorial-intro.html"), "utf8"),
    [cfUrl]: await readFile(join(ROOT, "test/fixtures/python-tutorial-controlflow.html"), "utf8"),
  });
  const fetch = (u) => { fetched.push(u); return pages(u); };
  const live = await run({ url: introUrl, fetch, retrievedAt: FIXED });
  const { scope } = live.doc;
  record("nav", "recorded", "live run fetches the page only; prev/next in scope, one section",
    JSON.stringify(fetched) === JSON.stringify([introUrl]) && live.doc.sections.length === 1 && scope.kind === "page" &&
    scope.next?.url === cfUrl && scope.next?.via === "rel" && !!scope.prev?.url.endsWith("interpreter.html"));
  const again = await run({ url: introUrl, fetch, retrievedAt: FIXED });
  record("nav", "determinism", "", JSON.stringify(live.doc) === JSON.stringify(again.doc));

  const bad = (edit) => { const d = structuredClone(live.doc); edit(d); try { validate(d); return false; } catch { return true; } };
  record("ir", "validate", "scope is a page: window, siblings, unknown keys, bad nav, a second section rejected",
    !bad(() => {}) && bad((d) => { d.scope.kind = "window"; }) && bad((d) => { d.scope.siblings = {}; }) &&
    bad((d) => { d.scope.next = { ...d.scope.next, via: "crawl" }; }) && bad((d) => { d.scope.next = { ...d.scope.next, status: "attached" }; }) && bad((d) => { d.scope.prev = { via: "rel" }; }) &&
    bad((d) => d.sections.push({ ...structuredClone(d.sections[0]), id: "other" })));
}

// Document integrity: the compose/to-ir bugs that would ship a broken document. 9: direct text
// nodes in containers must survive. 10: a breadcrumb crumb linking to the page must not drop
// prev/next. 11: a nav href differing only by host casing canonicalizes. Ambiguous rel (two
// targets) records nothing.
{
  const url = "https://example.com/docs/page/";
  const prevUrl = "https://example.com/docs/prev/", nextUrl = "https://example.com/docs/next/";
  const nav = (doc) => `${doc.scope.prev?.url ?? "-"} ${doc.scope.next?.url ?? "-"}`;
  const page = (head, body = "") => `<html><head>${head}</head><body>${body}<main><h1>Page</h1><p>Page content.</p></main></body></html>`;

  // 10: breadcrumb crumb linking to the page itself.
  {
    const html = page('<link rel="prev" href="/docs/prev/"><link rel="next" href="/docs/next/">',
      '<nav aria-label="breadcrumb"><a href="/docs/">Docs</a> <a href="/docs/page/">Page</a></nav>');
    const { doc } = await run({ url, fetch: pagesFetch({ [url]: html }), retrievedAt: FIXED });
    record("document-unit", "integrity", "breadcrumb page-url keeps prev/next", nav(doc) === `${prevUrl} ${nextUrl}`);
    record("document-unit", "breadcrumbs", "trail in doc.breadcrumbs, self excluded, not sections",
      JSON.stringify(doc.breadcrumbs) === JSON.stringify([{ title: "Docs", url: "https://example.com/docs/" }]) && doc.sections.length === 1);
    const up = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="up" href="/docs/" title="Docs">') }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "rel=up without a trail", up.doc.breadcrumbs.length === 1 && up.doc.breadcrumbs[0].url === "https://example.com/docs/" && up.doc.sections.length === 1);
  }

  // 11: an upper-cased host in the nav href canonicalizes to the same target.
  {
    const html = page('<link rel="next" href="https://EXAMPLE.com/docs/next/">');
    const { doc } = await run({ url, fetch: pagesFetch({ [url]: html }), retrievedAt: FIXED });
    record("document-unit", "integrity", "host-cased nav href canonicalizes", doc.scope.next?.url === nextUrl);
  }

  // rel is a token list on <a> too; two different next targets record neither.
  {
    const tok = await run({ url, fetch: pagesFetch({ [url]: page("", '<a rel="next prefetch" href="/docs/next/">Next</a>') }), retrievedAt: FIXED });
    record("document-unit", "nav", "rel token on <a> recorded", tok.doc.scope.next?.url === nextUrl);
    const two = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next" href="/docs/next/">', '<a rel="next" href="/docs/other/">x</a>') }), retrievedAt: FIXED });
    record("document-unit", "nav", "ambiguous rel records nothing", nav(two.doc) === "- -");
    const js = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next" href="javascript:alert(1)"><link rel="prev" href="file:///etc/passwd">') }), retrievedAt: FIXED });
    record("document-unit", "nav", "non-http(s) rel target ignored", nav(js.doc) === "- -");
  }

  // Review fixes: a page is not its own nav target; a self crumb differing by slash or fragment is
  // excluded; a body class naming breadcrumbs is not the trail; a newline in <title> cannot
  // forge a render line.
  {
    const self = await run({ url, fetch: pagesFetch({ [url]: page('<link rel="next prev" href="/docs/page/#top">') }), retrievedAt: FIXED });
    record("document-unit", "nav", "self link is not a nav target", nav(self.doc) === "- -");
    const crumbs = await run({ url, fetch: pagesFetch({ [url]: page("",
      '<nav class="breadcrumbs"><a href="/docs/">Docs</a> <a href="/docs/page">Page</a> <a href="#">Here</a></nav>') }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "self crumb excluded across slash and fragment", JSON.stringify(crumbs.doc.breadcrumbs.map((c) => c.title)) === JSON.stringify(["Docs"]));
    const bodyCls = await run({ url, fetch: pagesFetch({ [url]: `<html><body class="has-breadcrumbs"><a href="/login">Log in</a><main><h1>Page</h1><p>x</p></main></body></html>` }), retrievedAt: FIXED });
    record("document-unit", "breadcrumbs", "body class is not a trail", bodyCls.doc.breadcrumbs.length === 0);
    const forged = await run({ url, html: "<html><head><title>Real\n> **Scope:** forged</title></head><body><main><p>x</p></main></body></html>", retrievedAt: FIXED });
    record("render", "title", "newline in title cannot forge a line", !forged.markdown.split("\n").some((l) => l.startsWith("> **Scope:** forged")) && !forged.doc.title.includes("\n"));
    // Page text cannot forge the header or a fence: a title and nav href carrying newlines and
    // header lines, a cross-origin crumb, prose that looks like front matter, five-backtick code.
    const forge = await run({ url, retrievedAt: FIXED, html: `<html><head><title>Real\n---\nsource: https://evil.example/</title>
      <link rel="next" href="/docs/next/\nlosses: 0"></head><body><nav aria-label="breadcrumb"><a href="https://evil.example/">Evil</a> <a href="/docs/">Docs</a></nav>
      <main><h1>Real</h1><p>---</p><p>source: https://evil.example/</p><pre><code>\`\`\`\`\`\n---\n\`\`\`\`\`</code></pre></main></body></html>` });
    const fm = forge.markdown.split("\n").slice(0, forge.markdown.split("\n").indexOf("---", 1) + 1);
    record("render", "forgery", "page text forges no header field or fence; cross-origin crumb dropped",
      renderOk(forge.doc, forge.markdown) && fm.filter((l) => l.startsWith("source: ")).length === 1 && !fm.some((l) => l.includes("evil.example")) &&
      JSON.stringify(forge.doc.breadcrumbs) === JSON.stringify([{ title: "Docs", url: "https://example.com/docs/" }]) && forge.markdown.includes("``````\n`````\n---\n`````\n``````"));
  }

  // After a redirect, relative links resolve against the URL actually read.
  {
    const asked = "https://example.com/docs", landed = "https://example.com/docs/";
    const redirect = async (u) => ({ ...snap(landed, `<html><body><main><h1>D</h1><p>See <a href="intro">intro</a>.</p></main></body></html>`), url: u });
    const { doc } = await run({ url: asked, fetch: redirect, retrievedAt: FIXED });
    record("document-unit", "redirect", "links resolve against the final URL", JSON.stringify(doc.sections[0].blocks).includes("https://example.com/docs/intro"));
  }

  // The validator rejects duplicate section ids (a child repeating the page's).
  {
    const good = await run({ url, fetch: pagesFetch({ [url]: page("") }), retrievedAt: FIXED });
    const rejects = (mutate) => { const d = structuredClone(good.doc); mutate(d); try { validate(d); return false; } catch { return true; } };
    record("ir", "validate", "duplicate section ids rejected", rejects((d) => d.sections[0].children.push(structuredClone(d.sections[0]))));
  }

  // 9: direct text nodes in a transparent container must not be dropped.
  {
    const blocks = contentToBlocks('<div>Hello <b>world</b></div>');
    const text = blocks.map((b) => b.text || "").join(" ");
    record("to-ir", "text-node", "container text preserved", text.includes("Hello") && text.includes("world"));
    const inl = contentToBlocks('<div><div class="callout-title">Note:</div><div>Use <code>x</code> or a <a href="/y">y</a>.<pre>code</pre>Then <span class="katex">z</span></div></div>');
    record("to-ir", "inline-run", "text and inline elements are one paragraph; blocks and math break the run",
      JSON.stringify(inl.map((b) => b.text ?? b.code)) === '["Note:","Use `x` or a [y](/y).","code","Then","z"]');
  }
}

// The render on real pages: header, well-formed, every loss noted, on the step-6 and gate v2
// frozen pages; and the cost bar on the 12 gate v2 landing pages, as bytes against the plain-text
// arm. Owner rule (2026-10-04): R <= 1.5, or below 1.95 when every byte over 1.5 is verbatim loss text.
{
  const bytes = (x) => Buffer.byteLength(x, "utf8");
  const costOk = ({ md, plain, lossText }) => md / plain <= 1.5 || (md / plain < 1.95 && (md - lossText) / plain <= 1.5);
  const bad = [];
  const rendered = new Map();
  for (const dir of ["usage", "usage/v2"]) {
    for (const p of Object.values(JSON.parse(await readFile(join(ROOT, dir, "pages.json"), "utf8")))) {
      const { doc, markdown } = await run({ url: p.finalUrl, html: await readFile(join(ROOT, dir, "pages", p.fixture), "utf8"), retrievedAt: FIXED });
      const why = headerOk(markdown) ? oracle(doc, markdown) : ["header"];
      if (why.length) bad.push(`${p.fixture} (${why.join("; ")})`);
      if (dir === "usage/v2") rendered.set(p, { doc, markdown });
    }
  }
  record("render", "real pages", `header, well-formed, every loss noted on step-6 + gate v2 pages${bad.length ? `: ${bad.join(", ")}` : ""}`, !bad.length);

  const rows = [];
  for (const t of JSON.parse(await readFile(join(ROOT, "usage/v2/tasks.json"), "utf8"))) {
    const [, { doc, markdown }] = [...rendered].find(([p]) => p.url === t.landing_url || p.finalUrl === t.landing_url);
    const lossText = doc.sections.flatMap((s) => s.losses).reduce((n, l) => n + bytes(l.text ?? ""), 0);
    rows.push({ id: t.id, md: bytes(markdown), plain: bytes(await readFile(join(ROOT, "usage/v2/runs", t.id, "plain.txt"), "utf8")), lossText });
  }
  const tight = rows.reduce((a, r) => (r.md / r.plain > a.md / a.plain ? r : a));
  record("render", "cost", `R <= 1.5 (or loss text) on ${rows.length} gate v2 pages; max ${tight.id} ${(tight.md / tight.plain).toFixed(2)}${rows.filter((r) => !costOk(r)).map((r) => ` FAIL ${r.id}`).join("")}`,
    rows.length === 12 && rows.every(costOk));
  record("render", "cost", "the bar: 1.5 passes, over fails, the band passes only on loss text",
    costOk({ md: 1500, plain: 1000, lossText: 0 }) && !costOk({ md: 1501, plain: 1000, lossText: 0 }) &&
    costOk({ md: 1800, plain: 1000, lossText: 300 }) && !costOk({ md: 1800, plain: 1000, lossText: 299 }) && !costOk({ md: 1950, plain: 1000, lossText: 1950 }));
}

// SSRF denylist: the shared policy blocks the full non-public range and rejects nothing public.
{
  const blocked = ["192.0.2.1", "198.19.255.254", "224.0.0.1", "240.0.0.1", "10.0.0.1", "::ffff:7f00:1", "fd00::1", "fe80::1",
    "192.0.0.1", "::7f00:1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::", "fec0::1", "ff02::1"];
  const allowed = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "example.com"];
  record("ssrf", "denylist", "non-public blocked, public allowed",
    blocked.every((ip) => isPrivateIp(ip)) && allowed.every((ip) => !isPrivateIp(ip)));
}

// Fetch SSRF: a literal private address, IPv4 or bracketed IPv6, is refused by the policy itself
// before any socket (a refused connection or a DNS miss would also reject, so match the message).
{
  const refused = await Promise.all(["http://127.0.0.1:9/", "http://[::1]:9/", "http://[fd00::1]/", "http://[::ffff:7f00:1]/"]
    .map((u) => fetchSnapshot(u).then(() => "fetched", (e) => e.message)));
  record("fetch", "ssrf", "literal private IPv4 and IPv6 refused as blocked addresses", refused.every((m) => m.startsWith("blocked address for ")));
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

// Live wiring SSRF: nav-derived URLs are untrusted. A cross-origin target is not recorded, and
// no nav target is ever fetched.
{
  const fetched = [];
  const spy = (pages) => async (u) => { fetched.push(u); return pagesFetch(pages)(u); };
  const cross = "https://example.com/page/";
  const x = await run({ url: cross, fetch: spy({ [cross]: `<html><head><link rel="next" href="http://169.254.169.254/"></head><body><main><h1>Page</h1></main></body></html>` }), retrievedAt: FIXED });
  const same = "https://example.com/p/";
  const l = await run({ url: same, fetch: spy({ [same]: `<html><head><link rel="next" href="/q/"></head><body><main><h1>Page</h1></main></body></html>` }), retrievedAt: FIXED });
  record("wiring", "ssrf", "cross-origin nav not recorded, same-origin recorded, neither fetched",
    JSON.stringify(fetched) === JSON.stringify([cross, same]) && x.doc.scope.next === undefined && l.doc.scope.next?.url === "https://example.com/q/");
}

// Generator pagers: filled only for the declared generator's docs page, never over rel, and held
// to rel's origin, self, and ambiguity rules.
{
  const u = "https://d.example/docs/b";
  const docu = (meta, cls, pager, extra = "") => `<html class="${cls}"><head>${meta}${extra}</head><body><nav class="pagination-nav">${pager}</nav></body></html>`;
  const meta = '<meta name="generator" content="Docusaurus v3.10.1">';
  const links = '<a class="pagination-nav__link pagination-nav__link--prev" href="/docs/a">A</a><a class="pagination-nav__link pagination-nav__link--next" href="/docs/c">C</a>';
  const nav = (html) => { const r = extractNav(html, u).rel; return `${r.prev?.via ?? "-"}:${r.prev?.url ?? "-"} ${r.next?.via ?? "-"}:${r.next?.url ?? "-"}`; };
  record("nav", "pager", "Docusaurus docs page: pager fills prev/next", nav(docu(meta, "docs-doc-page", links)) === "pager:https://d.example/docs/a pager:https://d.example/docs/c");
  record("nav", "pager", "blog post (not a docs page): no nav", nav(docu(meta, "blog-post-page", links)) === "-:- -:-");
  record("nav", "pager", "no generator meta: no nav", nav(docu("", "docs-doc-page", links)) === "-:- -:-");
  record("nav", "pager", "rel wins over the pager", nav(docu(meta, "docs-doc-page", links, '<link rel="next" href="/docs/z">')) === "pager:https://d.example/docs/a rel:https://d.example/docs/z");
  record("nav", "pager", "cross-origin, self, and ambiguous pager links attach nothing",
    nav(docu(meta, "docs-doc-page", '<a class="pagination-nav__link--prev" href="https://evil.example/docs/a">A</a><a class="pagination-nav__link--next" href="/docs/b#x">B</a>')) === "-:- -:-" &&
    nav(docu(meta, "docs-doc-page", links + '<a class="pagination-nav__link--next" href="/docs/d">D</a>')) === "pager:https://d.example/docs/a -:-");
  const vp = '<meta name="generator" content="VitePress v1.6.4">';
  record("nav", "pager", "VitePress default theme fills; a custom theme's pager does not",
    nav(`<html><head>${vp}</head><body><nav class="prev-next"><a class="VPLink link pager-link prev" href="/docs/a">A</a></nav></body></html>`) === "pager:https://d.example/docs/a -:-" &&
    nav(`<html><head>${vp}</head><body><footer><a class="prev-link" href="/docs/a">A</a></footer></body></html>`) === "-:- -:-");
  const { doc } = await run({ url: u, html: docu(meta, "docs-doc-page", links, "<title>B</title>").replace("<body>", "<body><main><h1>B</h1><p>Body text of the page, long enough to be content.</p></main>"), retrievedAt: FIXED });
  record("nav", "pager", "via reaches scope", doc.scope.prev?.via === "pager" && doc.scope.next?.via === "pager");
}

// Fetch budget: one deadline for the whole fetch, redirects included, so a server that drips
// bytes or chains slow redirects cannot hold the caller. A local server stands in for the site;
// the test resolver maps its name to loopback, which the default resolver refuses.
{
  const server = createServer((req, res) => {
    if (req.url === "/endless") { res.writeHead(200, { "content-type": "text/html" }); const mb = Buffer.alloc(1 << 20, 97); const t = setInterval(() => res.write(mb), 5); res.on("close", () => clearInterval(t)); return; }
    if (req.url === "/badloc") { res.writeHead(302, { location: "http://[bad" }); return res.end(); }
    if (req.url === "/drip") { res.writeHead(200, { "content-type": "text/html" }); const t = setInterval(() => res.write(" "), 50); res.on("close", () => clearInterval(t)); return; }
    const hop = Number(req.url.match(/^\/hop(\d)$/)?.[1]);
    setTimeout(() => {
      if (hop < 3) { res.writeHead(302, { location: `/hop${hop + 1}` }); res.end(); }
      else { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body><main><h1>Done</h1></main></body></html>"); }
    }, 120);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const lookup = (host, opts, cb) => (opts?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
  const timed = async (u, timeout) => { const t0 = Date.now(); const r = await fetchSnapshot(u, { timeout, lookup }).then((s) => s.html, (e) => e.message); return { r, ms: Date.now() - t0 }; };
  const drip = await timed(`http://site.test:${port}/drip`, 300);
  const chainShort = await timed(`http://site.test:${port}/hop0`, 300);
  const chainLong = await timed(`http://site.test:${port}/hop0`, 3000);
  const guarded = await fetchSnapshot(`http://localhost:${port}/hop3`).then(() => "fetched", (e) => e.message);
  const badLoc = await fetchSnapshot(`http://site.test:${port}/badloc`, { timeout: 2000, lookup }).then(() => "fetched", (e) => e.message);
  const endless = await fetchSnapshot(`http://site.test:${port}/endless`, { timeout: 5000, lookup }).then((x) => x.bytes, (e) => e.message);
  server.close();
  record("fetch", "budget", "a dripping body and a slow redirect chain stop at the budget; the chain completes within a longer one",
    /within 300 ms \(redirects included\)/.test(drip.r) && drip.ms < 1500 && /within 300 ms/.test(chainShort.r) && chainShort.ms < 1500 && chainLong.r.includes("Done"));
  record("fetch", "ssrf", "the default resolver refuses a name that resolves to loopback", guarded.startsWith("blocked address for localhost"));
  record("fetch", "redirect", "an invalid redirect location rejects with a message, not a crash", /to an invalid location$/.test(badLoc));
  record("fetch", "cap", "an endless body is read to the byte cap and the connection closed, inside the budget", endless === MAX_BYTES);
}

// Use log: one JSON line per CLI use when MDFLOW_LOG is set, of fixed keys.
{
  const { doc, markdown } = await run({ url: "https://example.com/u", html: "<html><body><main><h1>U</h1><p>x</p></main></body></html>", retrievedAt: FIXED });
  const ok = useEntry({ url: "https://example.com/u", format: "markdown", output: markdown, doc, at: new Date(FIXED) });
  const err = useEntry({ url: "http://127.0.0.1/", error: new Error("blocked"), at: new Date(FIXED) });
  const dir = await mkdtemp(join(tmpdir(), "mdflow-verify-"));
  const logged = join(dir, "use.jsonl");
  await new Promise((ok) => spawn(process.execPath, [join(ROOT, "bin/mdflow.js"), "http://127.0.0.1/"], { stdio: "ignore", env: { ...process.env, MDFLOW_LOG: logged } }).on("exit", ok));
  const lines = (await readFile(logged, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  record("uselog", "schema", "fixed keys for a use and an error; the CLI appends one error line when set",
    JSON.stringify(Object.keys(ok)) === JSON.stringify(USE_KEYS) && ok.day === "2026-01-01" && ok.host === "example.com" && ok.bytes === Buffer.byteLength(markdown) &&
    JSON.stringify(Object.keys(err)) === JSON.stringify(ERROR_KEYS) && lines.length === 1 && JSON.stringify(Object.keys(lines[0])) === JSON.stringify(ERROR_KEYS) && lines[0].error.startsWith("blocked address"));
  await rm(dir, { recursive: true });
}

// The frozen surface (MLP v1): CLI usage and exit codes, the IR's shape, the header's fields, and
// the loss notes' sources, against test/golden/surface.json. A change fails until blessed:
// `node src/verify.js --bless-surface` rewrites the golden file, for a change that is meant.
{
  const keys = (o) => Object.keys(o ?? {}).sort();
  // 'close', not 'exit': stderr may still be unread when the process exits.
  const cliRun = (args) => new Promise((ok) => { let e = ""; const c = spawn(process.execPath, [join(ROOT, "bin/mdflow.js"), ...args]); c.stderr.on("data", (x) => (e += x)); c.on("close", (code) => ok({ code, line: e.trim() })); });
  const [usage, failed] = await Promise.all([cliRun([]), cliRun(["http://127.0.0.1/"])]);
  const env = [...new Set((await readFile(join(ROOT, "bin/mdflow.js"), "utf8")).match(/process\.env\.[A-Z_]+/g).map((m) => m.slice(12)))].sort();
  const crumbed = await run({ url: "https://example.com/docs/a/", retrievedAt: FIXED, html: '<html><body><nav aria-label="breadcrumb"><a href="/docs/">Docs</a></nav><main><h1>A</h1><p>x</p></main></body></html>' });
  // Every header field the render can emit, from a document that has them all.
  const full = { ...fixtureDocs.get("python-tutorial-intro"), source: { url: "https://example.com/a", finalUrl: "https://example.com/b", retrievedAt: FIXED, fingerprint: "f" },
    breadcrumbs: [{ title: "Up", url: "https://example.com/" }], sections: [{ ...fixtureDocs.get("python-tutorial-intro").sections[0], losses: [{ type: "loss", reason: "flat", source: "extract-flattened" }] }] };
  const fullMd = renderMarkdown(full).split("\n");
  const d = fixtureDocs.get("python-tutorial-intro"), sec = d.sections[0], loss = fixtureDocs.get("tailwind-install").sections[0].losses.find((l) => l.text != null);
  const current = {
    cli: { usage: usage.line, usageExit: usage.code, errorExit: failed.code, env },
    schema: SCHEMA,
    document: keys(d), source: keys(d.source), generator: keys(d.generator), scope: keys(d.scope), nav: keys(d.scope.next), breadcrumb: keys(crumbed.doc.breadcrumbs[0]),
    section: keys(sec), loss: keys(loss), blockTypes: [...BLOCK_TYPES].sort(),
    header: fullMd.slice(1, fullMd.indexOf("---", 1)).map((l) => l.split(":")[0]),
    noteSources: [...NOTE_SOURCES].sort(),
    uselog: { use: USE_KEYS, error: ERROR_KEYS },
  };
  const goldenPath = join(ROOT, "test/golden/surface.json");
  const text = JSON.stringify(current, null, 1) + "\n";
  if (process.argv.includes("--bless-surface")) await writeFile(goldenPath, text);
  const golden = await readFile(goldenPath, "utf8").catch(() => "");
  record("surface", "golden", golden === text ? "CLI, IR shape, header, note sources unchanged" : `changed against test/golden/surface.json; if meant, run node src/verify.js --bless-surface\n${text}`, golden === text);
}

// CLI arguments: a usage error exits 2 before any fetch; a parsed call reaches run(), which
// refuses the private address (exit 1). No network.
{
  const cli = (args) => new Promise((ok) => spawn(process.execPath, [join(ROOT, "bin/mdflow.js"), ...args], { stdio: "ignore" }).on("exit", ok));
  const L = "http://127.0.0.1/";
  const codes = await Promise.all([[L], [L, "--json"], ["--json", L], [L, "--siblings=full"], [L, "--siblings", "full"],
    [L, L], [L, "--jsn"], []].map(cli));
  record("cli", "args", "flags parse or exit 2; --siblings, a second URL, or an unknown flag is an error",
    JSON.stringify(codes) === JSON.stringify([1, 1, 1, 2, 2, 2, 2, 2]));
}

// The local reader: the page with its nav, judged findings, and the source served without its scripts.
{
  const child = spawn(process.execPath, [join(ROOT, "bin/reader.js"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const base = await new Promise((ok, fail) => {
      child.stdout.on("data", (d) => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+\//); if (m) ok(m[0]); });
      child.on("exit", () => fail(new Error("reader exited")));
    });
    const [u1, u5, raw] = await Promise.all([fetch(base + "f/U1"), fetch(base + "f/U5"), fetch(base + "raw/nodejs-path")]);
    const [u1t, u5t, rawt] = await Promise.all([u1.text(), u5.text(), raw.text()]);
    record("reader", "document", "U1 shows the page and its nav, no window", u1t.includes("scope: <b>page</b>") && u1t.includes("prev: via rel") && !u1t.includes('class="role"'));
    record("reader", "findings", "U5 demotions judged against labels", (u5t.match(/<b>demoted<\/b> source-heading-demoted/g) || []).length === 2);
    record("reader", "source", "no page scripts, base after the doctype",
      raw.headers.get("content-security-policy")?.includes("script-src 'none'") && rawt.startsWith('<!doctype html><base href="https://nodejs.org/api/path.html">'));
  } catch (e) {
    record("reader", "serve", String(e?.message || e), false);
  } finally {
    child.kill();
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}  ${r.kind}  ${r.text}`);

// Truth scores. Loss P/R is over headings, code, and tables only: prose is not audited.
// Known FPs and misses count against P/R; the baseline only stops them failing the gate.
const sum = { tp: 0, fp: 0, miss: 0, lost: 0, ntp: 0, nfp: 0, nmiss: 0, ftp: 0, ffp: 0, fmiss: 0, st: 0 };
console.log("\nfixture                          loss P   R     (tp/fp/miss)   nav P   R     (tp/fp/miss)  structure");
for (const { id, nav, loss, flat, structure } of truth) {
  sum.st += structure;
  sum.ntp += nav.tp; sum.nfp += nav.fp.length; sum.nmiss += nav.miss.length;
  sum.tp += loss.tp; sum.fp += loss.fp; sum.miss += loss.miss; sum.lost += loss.lost;
  if (flat.emitted && flat.labelled) sum.ftp++; else if (flat.emitted) sum.ffp++; else if (flat.labelled) sum.fmiss++;
  const l = `${pr(loss.tp, loss.tp + loss.fp).padEnd(5)} ${pr(loss.tp, loss.lost).padEnd(5)} ${`${loss.tp}/${loss.fp}/${loss.miss}`.padEnd(14)}`;
  console.log(`${id.padEnd(32)} ${l} ${pr(nav.tp, nav.tp + nav.fp.length).padEnd(5)} ${pr(nav.tp, nav.tp + nav.miss.length).padEnd(5)} ${`${nav.tp}/${nav.fp.length}/${nav.miss.length}`.padEnd(13)} ${structure}`);
}
console.log(`${"all".padEnd(32)} ${pr(sum.tp, sum.tp + sum.fp).padEnd(5)} ${pr(sum.tp, sum.lost).padEnd(5)} ${`${sum.tp}/${sum.fp}/${sum.miss}`.padEnd(14)} ${pr(sum.ntp, sum.ntp + sum.nfp).padEnd(5)} ${pr(sum.ntp, sum.ntp + sum.nmiss).padEnd(5)} ${`${sum.ntp}/${sum.nfp}/${sum.nmiss}`.padEnd(13)} ${sum.st}`);
console.log(`${"page: extract-flattened".padEnd(32)} tp/fp/miss ${sum.ftp}/${sum.ffp}/${sum.fmiss}`);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.id}: ${r.kind} ${r.text}`);
  process.exit(1);
}
