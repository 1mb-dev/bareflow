// Seed scoring (prereg.md): blind order per task, then d = score(M) - score(W) from the grader's
// grades. Usage: node usage/seed/score.js <grades.json>  (writes runs/permutation.json, runs/score.json)
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const tasks = JSON.parse(readFileSync(join(DIR, "tasks.json"), "utf8"));
// X is M when the low bit of the first hex digit of sha256(id + "seed") is 1, else X is W.
export const order = (id) => (parseInt(createHash("sha256").update(id + "seed").digest("hex")[0], 16) & 1 ? { X: "M", Y: "W" } : { X: "W", Y: "M" });

// Run as a script (not when imported for order()), through a symlinked checkout too.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const gradesPath = process.argv[2];
  if (!gradesPath) { console.error("usage: node usage/seed/score.js <grades.json>"); process.exit(2); }
  const grades = JSON.parse(readFileSync(gradesPath, "utf8"));
  // Every task, both answers, one score of 0 or 1 per rubric claim, in rubric order: a missing
  // claim would score an arm a point high and can flip the go/no-go count.
  const rubric = JSON.parse(readFileSync(join(DIR, "rubric.json"), "utf8"));
  for (const t of tasks) for (const k of ["X", "Y"]) for (const part of ["must_contain", "wrong"]) {
    const got = grades[t.id]?.[k]?.[part], want = rubric[t.id][part].length;
    if (!Array.isArray(got) || got.length !== want || !got.every((c) => c.score === 0 || c.score === 1)) {
      console.error(`grades ${t.id}.${k}.${part}: want ${want} scores of 0 or 1, got ${JSON.stringify(got)?.slice(0, 80)}`);
      process.exit(1);
    }
  }
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
