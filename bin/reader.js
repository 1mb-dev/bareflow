#!/usr/bin/env node
// Local reader: source | document | findings, side by side, for the frozen test fixtures, the
// step-6 usage pages, and live URLs through run(). Read-only: writes nothing, binds 127.0.0.1.
// Usage: mdflow-reader [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/pipeline.js";
import { scoreLoss, scoreNav } from "../src/truth.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] ?? 4380);
const FIXED = "2026-01-01T00:00:00.000Z";
const load = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));
const inventory = await load("test/inventory.json");
const usageTruth = await load("usage/truth.json");

const entries = new Map();
for (const [id, spec] of Object.entries(inventory)) entries.set(id, { id, group: "fixture", spec, file: join(ROOT, "test/fixtures", spec.fixture) });
for (const [id, spec] of Object.entries(usageTruth)) entries.set(id, { id, group: "usage", spec, file: join(ROOT, "usage/pages", spec.fixture) });

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const kindOf = (l) => (l.source?.match(/^source-(heading|code|table)-/) || [])[1] ?? "";
const short = (s, n = 110) => (s.length > n ? s.slice(0, n) + "..." : s);

function blockHtml(b) {
  switch (b.type) {
    case "heading": return `<h${Math.min(b.level + 1, 6)} class="h">${"#".repeat(b.level)} ${esc(b.text)}</h${Math.min(b.level + 1, 6)}>`;
    case "paragraph": return `<p>${esc(b.text)}</p>`;
    case "code": return `<pre><code>${esc(b.code)}</code></pre>${b.lang ? `<div class="lang">${esc(b.lang)}</div>` : ""}`;
    case "blockquote": return `<blockquote>${esc(b.text)}</blockquote>`;
    case "list": return `<${b.ordered ? "ol" : "ul"}>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    case "image": return `<p class="muted">[image: ${esc(b.alt)}] ${esc(b.src)}</p>`;
    case "table": return `<table><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
    default: return `<p class="muted">[${esc(b.type)}]</p>`;
  }
}

function documentHtml(doc) {
  const nav = (r) => { const x = doc.scope[r]; return `${r}: ${x ? `via ${esc(x.via)} <span class="muted">${esc(x.url)}</span>` : "<b>none</b>"}`; };
  const crumbs = doc.breadcrumbs?.length ? `<div class="muted">${doc.breadcrumbs.map((c) => esc(c.title)).join(" / ")}</div>` : "";
  const sections = [];
  const walk = (s) => {
    sections.push(`<section><h1>${esc(s.title)}</h1>${s.blocks.map(blockHtml).join("")}</section>`);
    for (const c of s.children) walk(c);
  };
  for (const s of doc.sections) walk(s);
  return `<div class="scope">scope: <b>${esc(doc.scope.kind)}</b> &middot; ${nav("prev")} &middot; ${nav("next")}</div>${crumbs}${sections.join("")}`;
}

// Each emitted finding judged against the labels: an FP is whatever scoreLoss says, a demoted
// finding that is not an FP is a correct demotion, anything else a true positive.
function findingsHtml(doc, score) {
  const fps = [...(score?.fps ?? [])];
  const rows = [];
  for (const s of doc.sections) for (const l of s.losses) {
    const i = score ? fps.findIndex((f) => f.kind === kindOf(l) && f.text === l.text) : -1;
    const verdict = !score ? "" : i >= 0 ? `FP (${fps.splice(i, 1)[0].label})` : l.source.endsWith("-demoted") ? "demoted" : l.source === "extract-flattened" ? "page" : "TP";
    const cls = verdict.startsWith("FP") ? "bad" : verdict ? "good" : "";
    rows.push(`<li class="${cls}" data-kind="${kindOf(l)}" data-text="${esc(l.text ?? "")}"><b>${esc(verdict || "finding")}</b> ${esc(l.source)}: ${esc(short(l.text ?? l.reason ?? ""))}</li>`);
  }
  return rows.length ? `<ul class="find">${rows.join("")}</ul>` : `<p class="muted">No findings.</p>`;
}

function labelsHtml(score) {
  const order = { lost: 0, demoted: 1, chrome: 2, present: 3 };
  const items = [...score.items].sort((a, b) => order[a.label] - order[b.label]);
  return `<ul class="find">${items.map((it) => `<li class="lbl-${it.label}" data-kind="${esc(it.kind)}" data-text="${esc(it.text)}"><b>${it.label}</b> ${it.kind}: ${esc(short(it.text))}</li>`).join("")}</ul>`;
}

async function frozenView(e) {
  const html = await readFile(e.file, "utf8");
  const { doc } = await run({ url: e.spec.url, html, retrievedAt: FIXED });
  const score = scoreLoss(html, doc, e.spec);
  const nav = scoreNav(html, e.spec.url, e.spec.nav);
  const c = score.counts;
  const navLine = `nav tp ${nav.tp}${nav.miss.length ? `, miss ${esc(nav.miss.join(", "))}` : ""}${nav.fp.length ? `, <span class="bad">wrong ${esc(nav.fp.join(", "))}</span>` : ""}`;
  const side = `<h2>Audit</h2><div class="muted">tp ${c.tp} &middot; fp ${c.fp} &middot; miss ${c.miss} &middot; demoted ${c.demoted} &middot; universe ${c.universe}</div><div class="muted">${navLine}</div>
    ${findingsHtml(doc, score)}
    ${score.misses.length ? `<h2>Missed (labelled lost, no finding)</h2><ul class="find">${score.misses.map((m) => `<li class="bad" data-kind="${m.kind}" data-text="${esc(m.text)}">${m.kind}: ${esc(short(m.text))}</li>`).join("")}</ul>` : ""}
    ${score.errors.length ? `<h2>Truth check</h2><ul class="find">${score.errors.map((x) => `<li class="bad">${esc(x)}</li>`).join("")}</ul>` : ""}
    <h2>Labels <span class="muted">(click to find in source)</span></h2>${labelsHtml(score)}`;
  return page(e.id, `<iframe id="src" sandbox="allow-same-origin" src="/raw/${encodeURIComponent(e.id)}"></iframe>`, documentHtml(doc), side);
}

// Live pages go through run(), the CLI's path, SSRF guard included.
async function liveView(url, runFn) {
  let doc;
  try { ({ doc } = await runFn({ url })); } catch (e) { return page("live", "", `<p class="bad">mdflow: ${esc(e?.message || e)}</p>`, ""); }
  return page(doc.title, `<p class="pad"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p><p class="pad muted">Live pages are not framed. No labels: findings are unjudged.</p>`, documentHtml(doc), `<h2>Findings</h2>${findingsHtml(doc, null)}`);
}

function index() {
  const list = (g) => [...entries.values()].filter((e) => e.group === g).map((e) => `<li><a href="/f/${encodeURIComponent(e.id)}">${esc(e.id)}</a> <span class="muted">${esc(e.spec.url)}</span></li>`).join("");
  return page("mdflow reader", "", `<form action="/live"><input name="url" placeholder="https://..." size="60"> <button>Open live</button></form>
    <h2>Step-6 usage pages</h2><ul>${list("usage")}</ul><h2>Test fixtures</h2><ul>${list("fixture")}</ul>`, "", true);
}

function page(title, src, docHtml, side, plain = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  :root{--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--code:#f5f5f7;--good:#1a7f37;--bad:#c62828;--hl:#fff3b0}
  @media (prefers-color-scheme:dark){:root{--bg:#161617;--fg:#e8e8ed;--muted:#98989d;--line:#38383a;--code:#232325;--good:#56d364;--bad:#ff6b6b;--hl:#5c4d00}}
  body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
  header{padding:8px 16px;border-bottom:1px solid var(--line)} header a{color:inherit}
  .cols{display:grid;grid-template-columns:${plain ? "1fr" : "1fr 1fr 360px"};height:calc(100vh - 41px)}
  .cols>div{overflow:auto;border-right:1px solid var(--line);padding:0 16px} .cols>div:first-child{padding:0}
  iframe{width:100%;height:100%;border:0;background:#fff}
  pre{background:var(--code);padding:8px;overflow:auto} table{border-collapse:collapse} td,th{border:1px solid var(--line);padding:2px 6px;vertical-align:top}
  p,li,blockquote{overflow-wrap:anywhere}
  .muted{color:var(--muted)} .good b{color:var(--good)} .bad,.bad b{color:var(--bad)} .pad{padding:0 16px}
  .scope{margin:12px 0;padding:6px 8px;background:var(--code)} section{border-top:2px solid var(--line);margin-top:16px}
  .h{font-size:15px} .lang{font-size:11px;color:var(--muted);margin-top:-12px}
  .find{list-style:none;padding:0} .find li{padding:3px 0;border-bottom:1px solid var(--line);cursor:pointer;word-break:break-word}
  .lbl-lost b,.lbl-demoted b{color:var(--bad)} .lbl-chrome b{color:var(--muted)} .lbl-present b{color:var(--good)} h2{font-size:14px;margin:16px 0 4px}
  </style></head><body><header><a href="/">mdflow reader</a> &middot; ${esc(title)}</header>
  ${plain ? `<div class="pad">${docHtml}</div>` : `<div class="cols"><div>${src}</div><div>${docHtml}</div><div>${side}</div></div>`}
  <script>
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const tags = { heading: "h1,h2,h3,h4,h5,h6", code: "pre", table: "table" };
  let last;
  document.addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-text]"); const f = document.getElementById("src");
    if (!li || !f || !f.contentDocument) return;
    const want = norm(li.dataset.text).slice(0, 40);
    const el = [...f.contentDocument.querySelectorAll(tags[li.dataset.kind] || "*")].find((e) => norm(e.textContent).includes(want));
    if (last) last.style.outline = last.dataset.o || "";
    if (!el) { li.title = "not found in source"; return; }
    last = el; el.dataset.o = el.style.outline; el.style.outline = "3px solid #f5a623"; el.scrollIntoView({ block: "center" });
  });
  </script></body></html>`;
}

// The reader's server; runFn is run() unless verify passes one over frozen pages (an import,
// never an argument or env, so it opens no fetch path).
export function createReader({ run: runFn = run } = {}) {
const server = createServer(async (req, res) => {
  // Loopback names only: a page in the owner's browser that rebinds its own name to 127.0.0.1
  // could otherwise read the reader's responses.
  const port = server.address().port;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("forbidden host"); }
  const u = new URL(req.url, "http://localhost");
  const send = (code, body, type = "text/html; charset=utf-8", extra = {}) => { res.writeHead(code, { "content-type": type, ...extra }); res.end(body); };
  try {
    if (u.pathname === "/") return send(200, index());
    if (u.pathname === "/live") return send(200, await liveView(u.searchParams.get("url") || "", runFn));
    const [, kind, id] = u.pathname.split("/").map(decodeURIComponent);
    const e = entries.get(id);
    if (!e) return send(404, "not found", "text/plain");
    // The frozen page as the site served it, styled from the site (<base>), never its scripts.
    if (kind === "raw") {
      const raw = await readFile(e.file, "utf8"), base = `<base href="${esc(e.spec.url)}">`;
      const html = /<head[\s>]/i.test(raw) ? raw.replace(/<head(\s[^>]*)?>/i, (m) => m + base) : raw.replace(/^\s*(<!doctype[^>]*>)?/i, (m) => m + base);
      return send(200, html, "text/html; charset=utf-8", { "content-security-policy": "script-src 'none'; frame-ancestors 'self'" });
    }
    if (kind === "f") return send(200, await frozenView(e));
    send(404, "not found", "text/plain");
  } catch (err) {
    send(500, `error: ${err?.message || err}`, "text/plain");
  }
});
return server;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createReader();
  server.listen(PORT, "127.0.0.1", () => console.log(`mdflow reader: http://127.0.0.1:${server.address().port}/`));
}
