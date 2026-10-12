// Contact sheet: every frozen page (test/fixtures and test/pages) in the site's real result view,
// for a person to review the design. `npm run contact` writes dist/contact/ and serves it on
// localhost; the sheet takes ?w=375|1280, ?theme=light|dark, and ?page=<n> (6 per page), and each frame is view.html?i=<n>
// (add &mode=markdown for the raw view).
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/pipeline.js";
import { site } from "./site.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist/contact");
const FIXED = "2026-01-01T00:00:00.000Z";
const PORT = Number(process.env.PORT) || 8800;

const json = async (f) => JSON.parse(await readFile(join(ROOT, f), "utf8"));
const pages = [
  ...Object.entries(await json("test/inventory.json")).map(([name, s]) => ({ name, url: s.url, file: `test/fixtures/${s.fixture}` })),
  ...Object.entries(await json("test/pages.json")).map(([f, p]) => ({ name: f.replace(/\.html$/, ""), url: p.url, file: `test/pages/${f}` })),
];
// What the site's worker would post for each page.
const cases = [];
for (const p of pages) {
  const { doc, markdown } = await run({ url: p.url, html: await readFile(join(ROOT, p.file), "utf8"), retrievedAt: FIXED });
  const header = markdown.slice(0, markdown.indexOf("\n---\n"));
  cases.push({ name: p.name, url: p.url, markdown, doc, losses: Number(header.match(/^losses: (\d+)$/m)[1]), flattened: /^warning: /m.test(header) });
}

await site(OUT, "contact-sheet");
await mkdir(join(OUT, "cases"));
const tokens = await readFile(join(ROOT, "site/tokens.css"), "utf8");
const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)")).match(/:root \{[^}]*\}/)[0];
const entry = `
import { showView, summary, mode } from "./site/view.js";
const q = new URLSearchParams(location.search);
const c = await (await fetch("/cases/" + Number(q.get("i")) + ".json")).json();
document.getElementById("pointer").hidden = true;
document.getElementById("landing").hidden = true;
document.getElementById("result").hidden = false;
document.getElementById("banner").textContent = "Content from " + new URL(c.url).hostname + ", not 1mb.dev.";
document.getElementById("status").textContent = summary(c);
document.getElementById("note").hidden = false;
document.getElementById("original").href = c.url;
showView(c, c.url);
if (q.get("mode") === "markdown") mode(true);
`;
const viewer = await build({ stdin: { contents: entry, resolveDir: ROOT, loader: "js" }, bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" });
const shell = (await readFile(join(OUT, "index.html"), "utf8"))
  .replace(/<script src="https:\/\/challenges[^>]*><\/script>\n/, "")
  .replace('<script type="module" src="/_app/app.js"></script>', '<script>if (new URLSearchParams(location.search).get("theme") === "dark") document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/dark.css" }));</script>\n<script type="module" src="/viewer.js"></script>');
const sheet = `<!doctype html>
<html><head><meta charset="utf-8"><title>bareflow contact sheet</title>
<style>body { font: 14px/1.4 ui-monospace, monospace; margin: 16px; } nav a { margin-right: 12px; } #sheet { display: flex; flex-wrap: wrap; gap: 32px 24px; align-items: flex-start; } figure { margin: 0; }
figcaption { margin: 0 0 4px; } iframe { border: 1px solid #888; display: block; }</style></head>
<body><nav>${["375 light", "375 dark", "1280 light", "1280 dark"].map((v) => { const [w, t] = v.split(" "); return `<a href="?w=${w}&theme=${t}">${v}</a>`; }).join("")}</nav>
<main id="sheet"></main>
<script>
const q = new URLSearchParams(location.search), w = Number(q.get("w")) || 375, theme = q.get("theme") || "light";
const scale = w > 800 ? 0.6 : 1;
const page = Number(q.get("page")) || 0, PER = 6;
fetch("/cases/index.json").then((r) => r.json()).then((cases) => {
  const nav = document.createElement("p");
  for (let p = 0; p * PER < cases.length; p++) nav.append(Object.assign(document.createElement("a"), { href: "?w=" + w + "&theme=" + theme + "&page=" + p, textContent: p === page ? "[" + p + "]" : String(p) }), " ");
  document.getElementById("sheet").before(nav);
  cases.slice(page * PER, page * PER + PER).forEach((c, k) => {
  const i = page * PER + k;
  const f = document.createElement("figure"), cap = document.createElement("figcaption"), frame = document.createElement("iframe");
  cap.textContent = i + " " + c.name + " (" + c.losses + " loss" + (c.losses === 1 ? "" : "es") + ") " + w + "px " + theme;
  frame.src = "/view.html?i=" + i + "&theme=" + theme;
  frame.style.width = w + "px"; frame.style.height = "900px";
  if (scale < 1) { frame.style.transform = "scale(" + scale + ")"; frame.style.transformOrigin = "0 0"; f.style.height = (900 * scale + 24) + "px"; }
  f.append(cap, frame);
  document.getElementById("sheet").append(f);
  });
});
</script></body></html>`;
await Promise.all([
  writeFile(join(OUT, "view.html"), shell),
  writeFile(join(OUT, "viewer.js"), viewer.outputFiles[0].text),
  writeFile(join(OUT, "dark.css"), dark),
  ...cases.map((c, i) => writeFile(join(OUT, "cases", `${i}.json`), JSON.stringify(c))),
  writeFile(join(OUT, "cases", "index.json"), JSON.stringify(cases.map(({ name, losses }) => ({ name, losses })))),
  writeFile(join(OUT, "sheet.html"), sheet),
]);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".woff2": "font/woff2" };
createServer(async (req, res) => {
  const path = normalize(new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/sheet.html"));
  const file = join(OUT, path);
  if (!file.startsWith(OUT + "/") || !TYPES[extname(file)]) { res.writeHead(404); return res.end(); }
  try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": "no-store" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(PORT, "127.0.0.1", () => console.log(`contact: ${cases.length} pages; open http://localhost:${PORT}/ (?w=375|1280&theme=light|dark; Ctrl-C to stop)`));
