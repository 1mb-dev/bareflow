// Build the two inputs each step-6 task agent gets, from the frozen pages only:
//   mdflow.json  the typed IR, siblings attached from their frozen copies (what `mdflow --json` returns)
//   plain.txt    the task page as plain text: the stand-in for an agent's fetch tool
// and score the audit on the task page against usage/truth.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/pipeline.js";
import { scoreLoss } from "../src/truth.js";
import { plainText } from "./plain.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const pages = JSON.parse(await readFile(join(HERE, "pages.json"), "utf8"));
const truth = JSON.parse(await readFile(join(HERE, "truth.json"), "utf8"));

const byUrl = new Map();
for (const p of Object.values(pages)) for (const u of [p.url, p.finalUrl]) byUrl.set(u, p);
const frozenFetch = async (u) => {
  const p = byUrl.get(u);
  if (!p) throw new Error(`not frozen: ${u}`);
  const html = await readFile(join(HERE, "pages", p.fixture), "utf8");
  return { url: u, finalUrl: p.finalUrl, status: 200, contentType: "text/html", bytes: Buffer.byteLength(html), html, fingerprint: p.sha256.slice(0, 16), retrievedAt: p.retrievedAt };
};

const summary = {};
for (const [task, spec] of Object.entries(truth)) {
  const dir = join(HERE, "runs", task);
  await mkdir(dir, { recursive: true });
  const html = await readFile(join(HERE, "pages", spec.fixture), "utf8");
  const { doc } = await run({ url: spec.url, fetch: frozenFetch });
  const json = JSON.stringify(doc, null, 2);
  const plain = plainText(html);
  await writeFile(join(dir, "mdflow.json"), json + "\n");
  await writeFile(join(dir, "plain.txt"), plain);

  // The task page's audit against its labels (the page section only; sibling findings are judged by hand).
  const page = doc.sections.find((s) => s.url === spec.url || s.url === pages[spec.fixture]?.finalUrl) ?? doc.sections[0];
  const pageDoc = { ...doc, sections: [{ ...page, children: [] }] };
  const score = scoreLoss(html, pageDoc, spec);
  const losses = doc.sections.flatMap((s) => s.losses.map((l) => ({ section: s.url, source: l.source, reason: l.reason })));
  summary[task] = {
    scope: doc.scope,
    chars: { mdflow: json.length, plain: plain.length },
    pageAudit: { ...score.counts, fps: score.fps.map((f) => `${f.kind} "${f.text.slice(0, 60)}" (${f.label})`), misses: score.misses.map((m) => `${m.kind} "${m.text.slice(0, 60)}"`), errors: score.errors },
    losses,
  };
}
await writeFile(join(HERE, "runs", "summary.json"), JSON.stringify(summary, null, 2) + "\n");
for (const [t, s] of Object.entries(summary)) {
  console.log(t, `scope=${s.scope.kind} prev=${s.scope.siblings.prev.status} next=${s.scope.siblings.next.status}`,
    `chars mdflow=${s.chars.mdflow} plain=${s.chars.plain}`, `audit tp/fp/miss=${s.pageAudit.tp}/${s.pageAudit.fp}/${s.pageAudit.miss}`, `losses=${s.losses.length}`);
}
