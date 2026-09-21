// Phase 0: run Jina Reader (r.jina.ai) over the corpus URLs.
// Jina fetches + renders live; we opt out of its cache for determinism.
// Saves raw text (with Jina's header block + warnings), stripped markdown, and metadata.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));
const ids = process.argv.slice(2);
const items = corpus.items.filter((it) => ids.length === 0 || ids.includes(it.id));

const out = join(ROOT, "data/out/jina");
await mkdir(out, { recursive: true });

for (const it of items) {
  const rec = { id: it.id, url: it.url, category: it.category, extractor: "jina", version: "reader-api" };
  const jinaUrl = `https://r.jina.ai/${it.url}`;
  try {
    const res = await fetch(jinaUrl, {
      headers: {
        "X-No-Cache": "true",
        "Accept": "text/plain",
      },
      signal: AbortSignal.timeout(90_000),
    });
    rec.status = res.status;
    rec.rateLimitRemaining = res.headers.get("x-ratelimit-remaining");
    rec.tokens = res.headers.get("x-usage-tokens");
    const raw = await res.text();
    await writeFile(join(out, `${it.id}.raw.txt`), raw);

    // Split Jina's header block from the markdown body.
    const marker = "Markdown Content:";
    const idx = raw.indexOf(marker);
    const headerBlock = idx >= 0 ? raw.slice(0, idx) : "";
    const body = idx >= 0 ? raw.slice(idx + marker.length).replace(/^\n+/, "") : raw;

    rec.title = (headerBlock.match(/^Title:\s*(.*)$/m) || [])[1]?.trim() || null;
    rec.publishedTime = (headerBlock.match(/^Published Time:\s*(.*)$/m) || [])[1]?.trim() || null;
    rec.warnings = (headerBlock.match(/^Warning:.*$/gm) || []).map((s) => s.trim());
    rec.markdown = body;
    rec.wordCount = body.split(/\s+/).filter(Boolean).length;
    await writeFile(join(out, `${it.id}.md`), body);
    await writeFile(join(out, `${it.id}.json`), JSON.stringify(rec, null, 2));
    console.log(`done ${it.id}  ${rec.wordCount}w${rec.warnings?.length ? "  WARN:" + rec.warnings.length : ""}`);
  } catch (e) {
    rec.error = String(e?.cause?.code || e?.message || e);
    await writeFile(join(out, `${it.id}.json`), JSON.stringify(rec, null, 2));
    console.log(`FAIL ${it.id}  ${rec.error}`);
  }
  await new Promise((r) => setTimeout(r, 3500)); // stay under 20 req/min
}
console.log("done");
