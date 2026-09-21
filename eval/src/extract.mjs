// Phase 0: run Readability (jsdom) and Defuddle (linkedom) over the snapshots.
// Output per extractor: data/out/<extractor>/<id>.json (+ .md).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));
const ids = process.argv.slice(2);
const items = corpus.items.filter((it) => ids.length === 0 || ids.includes(it.id));

const turndown = new TurndownService({ codeBlockStyle: "fenced", headingStyle: "atx" });
turndown.use(gfm);

const rdVersion = JSON.parse(await readFile(join(ROOT, "node_modules/@mozilla/readability/package.json"), "utf8")).version;
const dfVersion = JSON.parse(await readFile(join(ROOT, "node_modules/defuddle/package.json"), "utf8")).version;

for (const it of items) {
  const html = await readFile(join(ROOT, "data/html", `${it.id}.html`), "utf8");
  const base = { id: it.id, url: it.url, category: it.category };

  // --- Readability (jsdom) ---
  const rdRec = { ...base, extractor: "readability", version: rdVersion };
  try {
    const dom = new JSDOM(html, { url: it.url });
    const article = new Readability(dom.window.document).parse();
    if (!article) throw new Error("no article");
    rdRec.title = article.title;
    rdRec.byline = article.byline;
    rdRec.excerpt = article.excerpt;
    rdRec.publishedTime = article.publishedTime;
    rdRec.siteName = article.siteName;
    rdRec.contentHtml = article.content;
    rdRec.markdown = turndown.turndown(article.content);
    rdRec.wordCount = article.textContent.split(/\s+/).filter(Boolean).length;
  } catch (e) {
    rdRec.error = String(e?.message || e);
  }
  await mkdir(join(ROOT, "data/out/readability"), { recursive: true });
  await writeFile(join(ROOT, "data/out/readability", `${it.id}.json`), JSON.stringify(rdRec, null, 2));
  await writeFile(join(ROOT, "data/out/readability", `${it.id}.md`), rdRec.markdown || `<!-- ERROR: ${rdRec.error} -->`);

  // --- Defuddle (linkedom) ---
  const dfRec = { ...base, extractor: "defuddle", version: dfVersion };
  try {
    const { document } = parseHTML(html);
    const res = await Defuddle(document, it.url);
    dfRec.title = res.title;
    dfRec.author = res.author;
    dfRec.description = res.description;
    dfRec.published = res.published;
    dfRec.site = res.site;
    dfRec.language = res.language;
    dfRec.wordCount = res.wordCount;
    dfRec.contentHtml = res.content;
    const md = await Defuddle(document, it.url, { markdown: true });
    dfRec.markdown = md.content;
  } catch (e) {
    dfRec.error = String(e?.message || e);
  }
  await mkdir(join(ROOT, "data/out/defuddle"), { recursive: true });
  await writeFile(join(ROOT, "data/out/defuddle", `${it.id}.json`), JSON.stringify(dfRec, null, 2));
  await writeFile(join(ROOT, "data/out/defuddle", `${it.id}.md`), dfRec.markdown || `<!-- ERROR: ${dfRec.error} -->`);

  console.log(`done ${it.id}  rd=${rdRec.wordCount ?? "ERR"}w  df=${dfRec.wordCount ?? "ERR"}w`);
}

await writeFile(join(ROOT, "data/meta/versions.json"), JSON.stringify({ readability: rdVersion, defuddle: dfVersion, jina: "reader-api" }, null, 2));
console.log("wrote versions.json");
