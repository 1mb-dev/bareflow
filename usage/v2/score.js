// Score gate v2 from the blind grades, by the rules in prereg.md. Inputs in runs/: grades.json
// (X/Y/Z), permutation.json (X/Y/Z -> arm, computed after grading), tokens.json, summary.json.
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, "runs");
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const tasks = await json(join(HERE, "tasks.json"));
const grades = await json(join(RUNS, "grades.json"));
const perm = await json(join(RUNS, "permutation.json"));
const tokens = await json(join(RUNS, "tokens.json"));
const summary = await json(join(RUNS, "summary.json"));

const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
const rows = [];
for (const t of tasks) {
  const byArm = {};
  for (const [label, arm] of Object.entries(perm[t.id])) {
    const g = grades[t.id][label];
    const m = t.must_contain.map((_, i) => g[`M${i + 1}`].score);
    const w = t.wrong.map((_, i) => g[`W${i + 1}`].score);
    if (![...m, ...w].every((s) => s === 0 || s === 1)) throw new Error(`${t.id} ${label}: score not 0/1`);
    const out = await readFile(join(RUNS, t.id, `out-${arm}.md`), "utf8");
    byArm[arm] = {
      score: m.reduce((a, b) => a + b, 0) - w.reduce((a, b) => a + b, 0),
      pass: m.every((s) => s === 1) && w.every((s) => s === 0),
      doc: (out.match(/\[doc\]/g) ?? []).length, memory: (out.match(/\[memory\]/g) ?? []).length,
      tokens: tokens[`${t.id}-${arm}`],
    };
  }
  // Reach: a rubric quote found in A's window but not in B's page. A is matched on its section
  // strings with inline Markdown stripped: the serialized JSON escapes quotes and newlines.
  const strs = [];
  const walk = (o) => { if (typeof o === "string") strs.push(o); else if (o && typeof o === "object") Object.values(o).forEach(walk); };
  walk((await json(join(RUNS, t.id, "mdflow.json"))).sections);
  const text = (s) => norm(s.replace(/`|\*\*|\[([^\]]*)\]\([^)]*\)/g, "$1"));
  const a = text(strs.join(" "));
  const b = text(await readFile(join(RUNS, t.id, "plain.txt"), "utf8"));
  const found = t.must_contain.map((m) => ({ a: a.includes(text(m.quote)), b: b.includes(text(m.quote)) }));
  const reach = found.filter((f) => f.a && !f.b).length;
  const quotes = { a: found.filter((f) => f.a).length, b: found.filter((f) => f.b).length, of: found.length };
  const R = summary[t.id].bytes.ratio;
  rows.push({ id: t.id, ...byArm, retained: !byArm.c.pass, d: byArm.a.score - byArm.b.score, reach, quotes, R, cost: R >= 1.95 ? "fail" : R <= 1.05 ? "pass" : "band" });
}

const kept = rows.filter((r) => r.retained);
const wins = kept.filter((r) => r.d > 0).length, losses = kept.filter((r) => r.d < 0).length;
const qualityGo = wins - losses >= 2;
const fails = rows.filter((r) => r.cost === "fail").length, band = rows.filter((r) => r.cost === "band").length;
const costHolds = fails <= 2;
const verdict = !qualityGo ? "quality no-go: the window is not the core on real tasks, reconvene"
  : costHolds ? "MLP go" : "quality go, cost fails: the projection needs work, not the scope";
const result = {
  retained: kept.length, wins, losses, ties: kept.length - wins - losses, harm: losses >= 2, qualityGo,
  cost: { fails, band, pass: rows.length - fails - band, holds: costHolds }, verdict,
  passes: Object.fromEntries(["a", "b", "c"].map((x) => [x, rows.filter((r) => r[x].pass).length])),
  rows,
};
await writeFile(join(RUNS, "score.json"), JSON.stringify(result, null, 2) + "\n");

console.log("| Task | A | B | C | kept | d | quotes in A/B | reach | R | cost | [doc] A/B | tokens A/B/C |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
const cell = (x) => `${x.score}${x.pass ? " P" : ""}`;
for (const r of rows) console.log(`| ${r.id} | ${cell(r.a)} | ${cell(r.b)} | ${cell(r.c)} | ${r.retained ? "y" : "n"} | ${r.retained ? r.d : "-"} | ${r.quotes.a}/${r.quotes.b} of ${r.quotes.of} | ${r.reach} | ${r.R.toFixed(2)} | ${r.cost} | ${r.a.doc}/${r.b.doc} | ${r.a.tokens}/${r.b.tokens}/${r.c.tokens} |`);
console.log(`\nretained ${kept.length}: wins ${wins}, losses ${losses}, ties ${result.ties}; harm ${result.harm}; quality ${qualityGo ? "go" : "no-go"}`);
console.log(`cost: ${fails} fail, ${band} band, ${result.cost.pass} pass; holds ${costHolds}`);
console.log(`passes A/B/C: ${result.passes.a}/${result.passes.b}/${result.passes.c}`);
console.log(`verdict: ${verdict}`);
