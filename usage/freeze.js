// Freeze the step-6 task pages and their prev/next siblings under usage/pages/, and record each
// file's URL and sha256 in usage/pages.json. Siblings are the rel links mdflow finds plus the
// hand-labelled pager in truth.json, so a nav fix can be measured later. Pages already frozen
// are kept, never refetched: the log replays these files, never the live site.
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
const read = async (f) => JSON.parse(await readFile(join(HERE, f), "utf8").catch(() => "{}"));
const pages = await read("pages.json");
const truth = await read("truth.json");

// Fetch and write one page unless it is already frozen; a non-200 page fails the whole run.
async function freeze(task, role, url) {
  const known = Object.values(pages).find((p) => p.url === url);
  if (known) return readFile(join(HERE, "pages", known.fixture), "utf8");
  const snap = await fetchSnapshot(url);
  if (snap.status !== 200) throw new Error(`${task} ${role} ${url}: status ${snap.status}`);
  const entry = { task, role, url, finalUrl: snap.finalUrl, fixture: file(url), sha256: sha256(snap.html), retrievedAt: snap.retrievedAt };
  await writeFile(join(HERE, "pages", entry.fixture), snap.html);
  pages[entry.fixture] = entry;
  return snap.html;
}

for (const [task, url] of Object.entries(TASKS)) {
  const html = await freeze(task, "page", url);
  const rel = extractNav(html, url).rel;
  for (const r of ["prev", "next"]) {
    const labelled = truth[task]?.nav?.[r];
    for (const u of new Set([rel[r]?.url, labelled !== "none" ? labelled : undefined].filter(Boolean))) await freeze(task, r, u);
  }
}
await writeFile(join(HERE, "pages.json"), JSON.stringify(pages, null, 2) + "\n");
for (const p of Object.values(pages)) console.log(p.task, p.role.padEnd(4), p.fixture);
// Fail loudly if a write was truncated.
for (const p of Object.values(pages)) if (sha256(await readFile(join(HERE, "pages", p.fixture), "utf8")) !== p.sha256) throw new Error(`sha mismatch: ${p.fixture}`);
