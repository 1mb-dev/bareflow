// MLP v1 bar (P5) from the dogfood logs: the use log ($MDFLOW_LOG, written by the CLI) and the
// notes log ($MDFLOW_NOTES, written by `note`), one JSON line each.
// Usage: node usage/dogfood/bar.js                      exit 0 the bar holds, 1 not yet, 2 bad input
//        node usage/dogfood/bar.js note <url> <outcome> [webfetch-enough=y|n] [loss-changed=y|n] [silent] [fix=<sha>]
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// answered / wrong: what an mdflow use led to. fallback: a docs fetch made with WebFetch or curl
// instead. resolved: a fix for the url's earlier wrong notes.
export const OUTCOMES = ["answered", "wrong", "fallback", "resolved"];
const FLAGS = { "webfetch-enough": "webfetch_enough", "loss-changed": "loss_changed" };

const day = (at = new Date()) => at.toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// A note from `note` arguments; a bad argument throws and nothing is written.
export function noteEntry(args, at = new Date()) {
  const [url, outcome, ...rest] = args;
  try { new URL(url); } catch { throw new Error(`not a URL: ${url}`); }
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome is one of ${OUTCOMES.join(", ")}, got ${outcome}`);
  const e = { day: day(at), url, outcome };
  for (const a of rest) {
    const [k, v] = a.split("=");
    if (FLAGS[k] && (v === "y" || v === "n")) e[FLAGS[k]] = v === "y";
    else if (a === "silent") e.silent = true;
    else if (k === "fix" && v) e.fix = v;
    else throw new Error(`unknown note argument: ${a}`);
  }
  if (outcome === "resolved" && !e.fix) throw new Error("resolved needs fix=<sha>");
  return e;
}

// JSON lines, each checked: a malformed line stops the count with its line number, so a typo
// cannot pass for a missing use or note.
export function parseLines(text, name, check) {
  return text.split("\n").filter((l) => l.trim()).map((l, i) => {
    let r;
    try { r = JSON.parse(l); } catch { throw new Error(`${name}:${i + 1}: not JSON`); }
    const bad = check(r);
    if (bad) throw new Error(`${name}:${i + 1}: ${bad}`);
    return r;
  });
}
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const checkUse = (r) => !DAY.test(r.day) ? "day is not YYYY-MM-DD" : typeof r.url !== "string" ? "no url" : "error" in r ? null
  : typeof r.host !== "string" ? "no host" : null;
export const checkNote = (r) => !DAY.test(r.day) ? "day is not YYYY-MM-DD" : typeof r.url !== "string" ? "no url"
  : !OUTCOMES.includes(r.outcome) ? `outcome ${r.outcome} is not one of ${OUTCOMES.join(", ")}` : null;

// The bar per the MLP v1 plan. Adoption (separate from the bar: >= 4 of the first 5 docs fetches
// through mdflow; <= 2 means build MCP) is counted by day: the logs keep no time of day, so a day
// holding both kinds across the cut gives a range.
export function bar({ uses, notes, goldenDay, today }) {
  const ok = uses.filter((u) => !("error" in u));
  const fallbacks = notes.filter((n) => n.outcome === "fallback");
  const unresolved = notes.filter((w) => w.outcome === "wrong" &&
    !notes.some((r) => r.outcome === "resolved" && r.url === w.url && r.day >= w.day)).length;
  const days = new Set(ok.map((u) => u.day)).size, hosts = new Set(ok.map((u) => u.host)).size;
  const silent = notes.filter((n) => n.silent).length;
  const notEnough = notes.filter((n) => n.webfetch_enough === false).length;
  const fetches = ok.length + fallbacks.length;
  const stable = goldenDay ? daysBetween(goldenDay, today) : 0;
  const criteria = [
    { name: "uses", value: ok.length, need: ">= 20", pass: ok.length >= 20 },
    { name: "days", value: days, need: ">= 10", pass: days >= 10 },
    { name: "hosts", value: hosts, need: ">= 8", pass: hosts >= 8 },
    { name: "unresolved wrong", value: unresolved, need: "0", pass: unresolved === 0 },
    { name: "silent breakage", value: silent, need: "0", pass: silent === 0 },
    { name: "fallback share", value: `${fallbacks.length}/${fetches}`, need: "< 20%", pass: fetches > 0 && fallbacks.length / fetches < 0.2 },
    { name: "WebFetch not enough", value: notEnough, need: ">= 5", pass: notEnough >= 5 },
    { name: "golden stable days", value: stable, need: ">= 7", pass: stable >= 7 },
  ];

  const byDay = new Map();
  const at = (d) => byDay.get(d) ?? byDay.set(d, { m: 0, f: 0 }).get(d);
  for (const u of ok) at(u.day).m++;
  for (const n of fallbacks) at(n.day).f++;
  let left = 5, lo = 0, hi = 0;
  for (const d of [...byDay.keys()].sort()) {
    if (!left) break;
    const { m, f } = byDay.get(d), take = Math.min(left, m + f);
    lo += Math.max(0, take - f); hi += Math.min(take, m); left -= take;
  }
  const seen = 5 - left;
  const verdict = seen < 5 ? "pending" : lo >= 4 ? "pass" : hi <= 2 ? "build MCP" : lo === hi ? "fail" : "undecided: order within a day unknown";
  return { criteria, adoption: { seen, mdflow: lo === hi ? `${lo}` : `${lo}-${hi}`, verdict }, holds: criteria.every((c) => c.pass), errors: uses.length - ok.length };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const usePath = process.env.MDFLOW_LOG || join(homedir(), "mdflow-use.jsonl");
  const notePath = process.env.MDFLOW_NOTES || join(homedir(), "mdflow-notes.jsonl");
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
  const USAGE = "usage: node usage/dogfood/bar.js | node usage/dogfood/bar.js note <url> <answered|wrong|fallback|resolved> [webfetch-enough=y|n] [loss-changed=y|n] [silent] [fix=<sha>]";
  const fail = (msg, usage) => { console.error(`bar: ${msg}`); if (usage) console.error(USAGE); process.exit(2); };
  if (process.argv[2] === "note") {
    let e;
    try { e = noteEntry(process.argv.slice(3)); } catch (err) { fail(err.message, true); }
    appendFileSync(notePath, JSON.stringify(e) + "\n");
    console.log(`noted in ${notePath}: ${JSON.stringify(e)}`);
    process.exit(0);
  }
  if (process.argv[2]) fail(`unknown command: ${process.argv[2]}`, true);
  let uses, notes;
  try { uses = parseLines(read(usePath), usePath, checkUse); notes = parseLines(read(notePath), notePath, checkNote); }
  catch (err) { fail(`${err.message} (fix or remove that line)`, false); }
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const goldenDay = execFileSync("git", ["log", "-1", "--format=%cs", "--", "test/golden/surface.json"], { cwd: root, encoding: "utf8" }).trim();
  const r = bar({ uses, notes, goldenDay, today: day() });
  console.log(`use log ${usePath}: ${uses.length} lines (${r.errors} errors); notes ${notePath}: ${notes.length}`);
  for (const c of r.criteria) console.log(`${c.pass ? "ok  " : "not "} ${c.name.padEnd(20)} ${String(c.value).padStart(6)}  need ${c.need}`);
  console.log(`adoption: mdflow ${r.adoption.mdflow} of the first ${r.adoption.seen} docs fetches (need >= 4 of 5; <= 2: build MCP): ${r.adoption.verdict}`);
  console.log(r.holds ? "MLP bar holds" : "MLP bar not met");
  process.exit(r.holds ? 0 : 1);
}
