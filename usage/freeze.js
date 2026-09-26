// Freeze the step-6 task pages and their rel prev/next siblings under usage/pages/, and record
// each file's URL and sha256 in usage/pages.json. Run once, before labelling; the log replays
// these files, never the live site.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSnapshot } from "../src/fetch.js";
import { extractNav } from "../src/compose.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS = {
  U1: "https://docs.sqlalchemy.org/en/20/tutorial/orm_related_objects.html",
  U2: "https://docs.astral.sh/uv/guides/integration/github/",
  U3: "https://playwright.dev/docs/test-configuration",
  U4: "https://doc.rust-lang.org/book/ch12-05-working-with-environment-variables.html",
  U5: "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/",
};

const file = (u) => `${new URL(u).hostname}${new URL(u).pathname}`.replace(/[^a-z0-9]+/gi, "_").replace(/_+$/, "") + ".html";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

await mkdir(join(HERE, "pages"), { recursive: true });
const pages = {};
for (const [task, url] of Object.entries(TASKS)) {
  const snap = await fetchSnapshot(url);
  if (snap.status !== 200) throw new Error(`${task} ${url}: status ${snap.status}`);
  const nav = extractNav(snap.html, snap.finalUrl).rel;
  const entry = { task, role: "page", url, finalUrl: snap.finalUrl, fixture: file(url), sha256: sha256(snap.html), retrievedAt: snap.retrievedAt };
  pages[entry.fixture] = entry;
  await writeFile(join(HERE, "pages", entry.fixture), snap.html);
  for (const r of ["prev", "next"]) {
    if (!nav[r]) continue;
    const s = await fetchSnapshot(nav[r].url);
    const sib = { task, role: r, url: nav[r].url, finalUrl: s.finalUrl, fixture: file(nav[r].url), sha256: sha256(s.html), retrievedAt: s.retrievedAt };
    pages[sib.fixture] = sib;
    await writeFile(join(HERE, "pages", sib.fixture), s.html);
  }
}
await writeFile(join(HERE, "pages.json"), JSON.stringify(pages, null, 2) + "\n");
for (const p of Object.values(pages)) console.log(p.task, p.role.padEnd(4), p.fixture);
// Fail loudly if a write was truncated.
for (const p of Object.values(pages)) if (sha256(await readFile(join(HERE, "pages", p.fixture), "utf8")) !== p.sha256) throw new Error(`sha mismatch: ${p.fixture}`);
