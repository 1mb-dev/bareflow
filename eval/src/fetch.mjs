// Phase 0: fetch raw HTML snapshots for the corpus.
// Snapshot once, run all extractors over the snapshot. Records retrieval timestamp
// and source fingerprint so outputs are versioned and reproducible.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB cap
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));
const ids = process.argv.slice(2);
const items = corpus.items.filter((it) => ids.length === 0 || ids.includes(it.id));

// Merge, never clobber: a partial re-run must not erase prior records.
let meta = {};
try {
  meta = JSON.parse(await readFile(join(ROOT, "data/meta/fetch.json"), "utf8"));
} catch {}

for (const it of items) {
  const rec = meta[it.id] || { id: it.id, url: it.url, category: it.category };
  try {
    const res = await fetch(it.url, {
      redirect: "follow",
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(30_000),
    });
    rec.status = res.status;
    rec.finalUrl = res.url;
    rec.contentType = res.headers.get("content-type") || "";
    rec.retrievedAt = new Date().toISOString();
    const buf = Buffer.from(await res.arrayBuffer());
    rec.bytes = buf.length;
    if (buf.length > MAX_BYTES) rec.truncated = true;
    const out = buf.subarray(0, MAX_BYTES);
    await mkdir(join(ROOT, "data/html"), { recursive: true });
    await writeFile(join(ROOT, "data/html", `${it.id}.html`), out);
    rec.savedBytes = out.length;
    rec.sha256 = sha(out);
    console.log(`ok   ${it.id}  status=${res.status}  ${out.length}B  ${it.url}`);
  } catch (e) {
    rec.error = String(e?.cause?.code || e?.message || e);
    rec.retrievedAt = new Date().toISOString();
    console.log(`FAIL ${it.id}  ${rec.error}`);
  }
  meta[it.id] = rec;
  await new Promise((r) => setTimeout(r, 300));
}

await mkdir(join(ROOT, "data/meta"), { recursive: true });
await writeFile(join(ROOT, "data/meta/fetch.json"), JSON.stringify(meta, null, 2));
console.log(`\nwrote data/meta/fetch.json (${Object.keys(meta).length} records)`);
