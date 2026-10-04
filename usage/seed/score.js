// Seed scoring (prereg.md): blind order per task, then d = score(M) - score(W) from the grader's
// grades. Usage: node usage/seed/score.js <grades.json>  (writes runs/permutation.json, runs/score.json)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(DIR, "tasks.json"), "utf8"));
// X is M when the low bit of the first hex digit of sha256(id + "seed") is 1, else X is W.
export const order = (id) => (parseInt(createHash("sha256").update(id + "seed").digest("hex")[0], 16) & 1 ? { X: "M", Y: "W" } : { X: "W", Y: "M" });

const gradesPath = process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2];
if (gradesPath) {
  const grades = JSON.parse(readFileSync(gradesPath, "utf8"));
  const score = (g) => g.must_contain.reduce((n, c) => n + c.score, 0) - g.wrong.reduce((n, c) => n + c.score, 0);
  const perm = Object.fromEntries(tasks.map((t) => [t.id, order(t.id)]));
  const rows = tasks.map((t) => {
    const p = perm[t.id], g = grades[t.id];
    const s = { [p.X]: score(g.X), [p.Y]: score(g.Y) };
    return { id: t.id, M: s.M, W: s.W, d: s.M - s.W };
  });
  const preferred = rows.filter((r) => r.d > 0).length, harm = rows.filter((r) => r.d < 0).length;
  const verdict = preferred >= 3 ? "go to P4" : "stop and reconvene";
  writeFileSync(join(DIR, "runs/permutation.json"), JSON.stringify(perm, null, 1) + "\n");
  writeFileSync(join(DIR, "runs/score.json"), JSON.stringify({ rows, preferred, harm_flag: harm >= 2, verdict }, null, 1) + "\n");
  for (const r of rows) console.log(`${r.id}  M ${r.M}  W ${r.W}  d ${r.d}`);
  console.log(`preferred ${preferred}/5, losses ${harm}, harm ${harm >= 2}: ${verdict}`);
}
