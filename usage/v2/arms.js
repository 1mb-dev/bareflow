// Build gate v2's three arm inputs per task from the frozen pages only, and record their bytes:
//   A  mdflow.json  compact JSON of the IR, window composed from frozen siblings (the agent surface)
//   B  plain.txt    the landing page as plain text: the stand-in for an agent's fetch tool
//   C  (none)       the question alone
// Cost is UTF-8 bytes of each input as written; the split is diagnostic and never decides.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../src/pipeline.js";
import { plainText } from "../plain.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(await readFile(join(HERE, "tasks.json"), "utf8"));
const pages = JSON.parse(await readFile(join(HERE, "pages.json"), "utf8"));

const byUrl = new Map();
for (const p of Object.values(pages)) for (const u of [p.url, p.finalUrl]) byUrl.set(u, p);
const frozenFetch = async (u) => {
  const p = byUrl.get(u);
  if (!p) throw new Error(`not frozen: ${u}`);
  const html = await readFile(join(HERE, "pages", p.fixture), "utf8");
  return { url: u, finalUrl: p.finalUrl, status: 200, contentType: "text/html", bytes: Buffer.byteLength(html), html, fingerprint: p.sha256.slice(0, 16), retrievedAt: p.retrievedAt };
};

const bytes = (s) => Buffer.byteLength(s);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const strings = (b) => [b.text, b.code, ...(b.items ?? []), ...(b.headers ?? []), ...(b.rows ?? []).flat()].filter((x) => typeof x === "string");
const textBytes = (s) => { let n = bytes(s.title); for (const b of s.blocks) for (const x of strings(b)) n += bytes(x); for (const c of s.children) n += textBytes(c); return n; };

const summary = {};
for (const t of tasks) {
  const dir = join(HERE, "runs", t.id);
  await mkdir(dir, { recursive: true });
  const land = byUrl.get(t.landing_url);
  const { doc } = await run({ url: t.landing_url, fetch: frozenFetch });
  const a = JSON.stringify(doc);
  const b = plainText(await readFile(join(HERE, "pages", land.fixture), "utf8"));
  await writeFile(join(dir, "mdflow.json"), a + "\n");
  await writeFile(join(dir, "plain.txt"), b);

  const page = doc.sections.find((s) => s.url === land.finalUrl || s.url === t.landing_url);
  const pageText = page ? textBytes(page) : 0;
  const siblingText = doc.sections.filter((s) => s !== page).reduce((n, s) => n + textBytes(s), 0);
  const A = bytes(a + "\n"), B = bytes(b);
  summary[t.id] = {
    scope: doc.scope,
    bytes: { A, B, ratio: +(A / B).toFixed(3) },
    split: { pageText, siblingText, format: A - pageText - siblingText },
    sha256: { A: sha256(a + "\n"), B: sha256(b) },
  };
}
await writeFile(join(HERE, "runs", "summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const [id, s] of Object.entries(summary)) {
  console.log(id, `scope=${s.scope.kind} prev=${s.scope.siblings.prev.status} next=${s.scope.siblings.next.status}`,
    `A=${s.bytes.A} B=${s.bytes.B} R=${s.bytes.ratio}`, `page=${s.split.pageText} sib=${s.split.siblingText} fmt=${s.split.format}`);
}
