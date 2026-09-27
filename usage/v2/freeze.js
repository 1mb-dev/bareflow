// Freeze gate v2's landing pages and the prev/next siblings mdflow finds on them under
// usage/v2/pages/, with each file's URL and sha256 in usage/v2/pages.json. Pages already frozen
// are kept, never refetched: the run replays these files, never the live site.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSnapshot } from "../../src/fetch.js";
import { extractNav } from "../../src/compose.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(await readFile(join(HERE, "tasks.json"), "utf8"));
const file = (u) => `${new URL(u).hostname}${new URL(u).pathname}`.replace(/[^a-z0-9]+/gi, "_").replace(/_+$/, "") + ".html";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

await mkdir(join(HERE, "pages"), { recursive: true });
const pages = JSON.parse(await readFile(join(HERE, "pages.json"), "utf8").catch(() => "{}"));

// Fetch and write one page unless it is already frozen; a non-200 page fails the whole run.
async function freeze(task, role, url) {
  const known = Object.values(pages).find((p) => p.url === url);
  if (known) return { html: await readFile(join(HERE, "pages", known.fixture), "utf8"), finalUrl: known.finalUrl };
  const snap = await fetchSnapshot(url);
  if (snap.status !== 200) throw new Error(`${task} ${role} ${url}: status ${snap.status}`);
  const entry = { task, role, url, finalUrl: snap.finalUrl, fixture: file(url), sha256: sha256(snap.html), retrievedAt: snap.retrievedAt };
  await writeFile(join(HERE, "pages", entry.fixture), snap.html);
  pages[entry.fixture] = entry;
  return { html: snap.html, finalUrl: snap.finalUrl };
}

for (const t of tasks) {
  const { html, finalUrl } = await freeze(t.id, "page", t.landing_url);
  const rel = extractNav(html, finalUrl).rel;
  for (const r of ["prev", "next"]) if (rel[r]) await freeze(t.id, r, rel[r].url);
}
await writeFile(join(HERE, "pages.json"), JSON.stringify(pages, null, 2) + "\n");
for (const p of Object.values(pages)) console.log(p.task, p.role.padEnd(4), p.fixture);
// Fail loudly if a write was truncated.
for (const p of Object.values(pages)) if (sha256(await readFile(join(HERE, "pages", p.fixture), "utf8")) !== p.sha256) throw new Error(`sha mismatch: ${p.fixture}`);
