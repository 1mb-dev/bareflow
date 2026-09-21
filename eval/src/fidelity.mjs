// Phase 0: structural-fidelity and multi-page-coherence metrics.
// Code/table fidelity is counted on each extractor's OWN output format:
//   readability/defuddle -> count <pre>/<code>/<table>/<img>/<a> in contentHtml
//   jina                -> count fenced code, indented code, table rows, images, links in markdown
// Coherence: does any extractor retain a docs section's sibling-page titles (nav = document)?
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));

function htmlCounts(html) {
  const tag = (re) => (html.match(re) || []).length;
  return {
    pre: tag(/<pre[\s>]/gi),
    code: tag(/<code[\s>]/gi),
    table: tag(/<table[\s>]/gi),
    img: tag(/<img[\s>]/gi),
    a: tag(/<a[\s>]/gi),
    h1: tag(/<h1[\s>]/gi),
    h2: tag(/<h2[\s>]/gi),
    h3: tag(/<h3[\s>]/gi),
  };
}

function mdCounts(md) {
  if (!md) return null;
  const lines = md.split("\n");
  let fenced = 0, indented = 0, tableRows = 0, img = 0, links = 0, h2 = 0, h3 = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```+|~~~+)/.test(line)) { inFence = !inFence; if (inFence) fenced++; continue; }
    if (inFence) continue;
    if (/^\s{4,}\S/.test(line)) indented++;
    else {
      if (/^\s*\|.*\|\s*$/.test(line) && line.includes("|")) tableRows++;
      if (/^#{2}\s/.test(line)) h2++;
      else if (/^#{3}\s/.test(line)) h3++;
    }
    img += (line.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    links += (line.match(/\[[^\]]*\]\([^)]*\)/g) || []).length;
  }
  return { fenced, indented, tableRows, img, links, h2, h3 };
}

// Multi-page coherence: sibling page titles that a document-unit tool should retain.
const SIBLINGS = {
  "python-tutorial-intro": ["More Control Flow Tools", "Using the Python Interpreter"],
  "python-tutorial-controlflow": ["An Informal Introduction to Python", "Data Structures"],
  "rust-book-ownership": ["References and Borrowing", "The Slice Type"],
  "rust-book-references": ["What Is Ownership", "The Slice Type"],
};

const fidelity = {};
const coherence = {};
for (const it of corpus.items) {
  fidelity[it.id] = { category: it.category };
  for (const ex of ["readability", "defuddle"]) {
    const j = JSON.parse(await readFile(join(ROOT, "data/out", ex, `${it.id}.json`), "utf8").catch(() => "{}"));
    fidelity[it.id][ex] = htmlCounts(j.contentHtml || "");
  }
  const md = await readFile(join(ROOT, "data/out/jina", `${it.id}.md`), "utf8").catch(() => null);
  fidelity[it.id].jina = mdCounts(md);

  if (SIBLINGS[it.id]) {
    coherence[it.id] = { siblings: SIBLINGS[it.id], retained: {} };
    for (const ex of ["readability", "defuddle", "jina"]) {
      const txt = await readFile(join(ROOT, "data/out", ex, `${it.id}.md`), "utf8").catch(() => "");
      coherence[it.id].retained[ex] = SIBLINGS[it.id].filter((t) => txt.includes(t));
    }
  }
}

await writeFile(join(ROOT, "data/meta/fidelity.json"), JSON.stringify(fidelity, null, 2));
await writeFile(join(ROOT, "data/meta/coherence.json"), JSON.stringify(coherence, null, 2));

console.log("=== code/table fidelity (pre / table / h2+h3) ===");
console.log("id\tcat\trd_pre\trd_tbl\tdf_pre\tdf_tbl\tji_code\tji_tbl");
for (const [id, v] of Object.entries(fidelity)) {
  const rd = v.readability, df = v.defuddle, ji = v.jina || {};
  console.log(`${id}\t${v.category}\t${rd.pre}\t${rd.table}\t${df.pre}\t${df.table}\t${ji.fenced ?? "·"}\t${ji.tableRows ?? "·"}`);
}
console.log("\n=== multi-page coherence (sibling titles retained) ===");
for (const [id, v] of Object.entries(coherence)) {
  console.log(`${id}: ${v.siblings.join(" | ")}`);
  for (const [ex, kept] of Object.entries(v.retained)) console.log(`  ${ex}: ${kept.length ? kept.join(", ") : "NONE"}`);
}
