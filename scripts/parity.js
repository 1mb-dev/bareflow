// Browser parity: the shipped bundle, in a real browser's Web Worker, against the CLI on every
// frozen page (test/fixtures and test/pages). `npm run parity` writes dist/parity/ and serves it
// on localhost; the page's title and <html data-parity> carry the verdict.
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/pipeline.js";
import { bundle } from "./bundle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/parity");
const FIXED = "2026-01-01T00:00:00.000Z";
const PORT = Number(process.env.PORT) || 8799;

const json = async (f) => JSON.parse(await readFile(join(ROOT, f), "utf8"));
const pages = [
  ...Object.entries(await json("test/inventory.json")).map(([name, s]) => ({ name, url: s.url, file: `test/fixtures/${s.fixture}` })),
  ...Object.entries(await json("test/pages.json")).map(([f, p]) => ({ name: f, url: p.url, file: `test/pages/${f}` })),
];
const cases = [];
for (const p of pages) {
  const html = await readFile(join(ROOT, p.file), "utf8");
  const { doc, markdown } = await run({ url: p.url, html, retrievedAt: FIXED });
  cases.push({ name: p.name, args: { url: p.url, html, retrievedAt: FIXED, input: "fetch" }, markdown, doc: JSON.stringify(doc) });
}

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>parity: running</title></head>
<body><pre id="out">running ${cases.length} pages...</pre>
<script>
const out = document.getElementById("out");
const done = (pass, text) => {
  document.documentElement.dataset.parity = pass ? "pass" : "fail";
  document.title = "parity: " + (pass ? "PASS" : "FAIL") + " " + text;
  out.textContent = navigator.userAgent + "\\n" + text;
};
fetch("cases.json").then((r) => r.json()).then((cases) => {
  const w = new Worker("worker.js");
  const off = [];
  let seen = 0;
  w.onmessage = ({ data }) => {
    const c = cases[data.i];
    if (data.error || data.markdown !== c.markdown || data.doc !== c.doc) off.push(c.name + (data.error ? " (" + data.error + ")" : ""));
    out.textContent = "running " + ++seen + "/" + cases.length + " pages (" + off.length + " differ)...";
    if (seen === cases.length) done(!off.length, (cases.length - off.length) + "/" + cases.length + " equal" + (off.length ? "\\ndiffer:\\n" + off.join("\\n") : ""));
  };
  w.onerror = (e) => done(false, "worker: " + e.message);
  w.postMessage(cases.map((c) => c.args));
});
</script></body></html>
`;
const glue = `
self.onmessage = async ({ data }) => {
  for (let i = 0; i < data.length; i++) {
    try { const { doc, markdown } = await bareflow.convert(data[i]); self.postMessage({ i, markdown, doc: JSON.stringify(doc) }); }
    catch (e) { self.postMessage({ i, error: String(e && e.message || e) }); }
  }
};`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await Promise.all([
  writeFile(join(OUT, "index.html"), page),
  writeFile(join(OUT, "worker.js"), `${await bundle()}\n${glue}`),
  writeFile(join(OUT, "cases.json"), JSON.stringify(cases)),
]);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json" };
createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/index.html");
  if (!["/index.html", "/worker.js", "/cases.json"].includes(path)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.slice(path.lastIndexOf("."))], "cache-control": "no-store" });
  res.end(await readFile(join(OUT, path)));
}).listen(PORT, "127.0.0.1", () => console.log(`parity: ${cases.length} pages; open http://localhost:${PORT}/ in each browser (Ctrl-C to stop)`));
