// Phase 0: determinism check (results persisted to data/meta/determinism.json).
// Readability + Defuddle: run twice on the same snapshot; a pure function must be byte-identical.
// Jina: re-fetch live twice; body identity + injected-warning variance are the real signal.
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const turndown = new TurndownService({ codeBlockStyle: "fenced", headingStyle: "atx" });
turndown.use(gfm);
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));
const localPages = ["python-tutorial-intro", "mdn-array-filter", "overreacted-useeffect", "kubernetes-components"];
const jinaPages = ["python-tutorial-intro", "kubernetes-components", "overreacted-useeffect", "caniuse-grid"];

const out = { local: {}, jina: {} };

for (const id of localPages) {
  const { url } = corpus.items.find((i) => i.id === id);
  const html = await readFile(join(ROOT, "data/html", `${id}.html`), "utf8");
  const run = () => turndown.turndown(new Readability(new JSDOM(html, { url }).window.document).parse()?.content || "");
  const a = run(), b = run();
  const dfRun = async () => (await Defuddle(parseHTML(html).document, url, { markdown: true })).content;
  const da = await dfRun(), db = await dfRun();
  out.local[id] = { readabilityIdentical: sha(a) === sha(b), defuddleIdentical: sha(da) === sha(db) };
  console.log(`${id}: readability ${sha(a) === sha(b) ? "IDENTICAL" : "DIFF"}  defuddle ${sha(da) === sha(db) ? "IDENTICAL" : "DIFF"}`);
}

for (const id of jinaPages) {
  const { url } = corpus.items.find((i) => i.id === id);
  const fetchJina = async () => {
    const res = await fetch(`https://r.jina.ai/${url}`, { headers: { "X-No-Cache": "true" }, signal: AbortSignal.timeout(90_000) });
    const raw = await res.text();
    const idx = raw.indexOf("Markdown Content:");
    return { body: idx >= 0 ? raw.slice(idx + "Markdown Content:".length) : raw, header: idx >= 0 ? raw.slice(0, idx) : "" };
  };
  const a = await fetchJina();
  await new Promise((r) => setTimeout(r, 3500));
  const b = await fetchJina();
  out.jina[id] = {
    bodyIdentical: sha(a.body) === sha(b.body),
    warningsA: (a.header.match(/^Warning:.*$/gm) || []).length,
    warningsB: (b.header.match(/^Warning:.*$/gm) || []).length,
  };
  console.log(`${id}: body ${sha(a.body) === sha(b.body) ? "IDENTICAL" : "DIFF"}  warnings a=${out.jina[id].warningsA} b=${out.jina[id].warningsB}`);
  await new Promise((r) => setTimeout(r, 3500));
}

await writeFile(join(ROOT, "data/meta/determinism.json"), JSON.stringify(out, null, 2));
console.log("wrote data/meta/determinism.json");
