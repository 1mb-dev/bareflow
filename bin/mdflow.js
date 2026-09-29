#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json] [--siblings headings+code|full]
import { run } from "../src/pipeline.js";
import { PROJECTIONS } from "../src/ir.js";

const USAGE = "usage: mdflow <url> [--json] [--siblings headings+code|full]";
const args = process.argv.slice(2);
let url, asJson = false, siblings = "headings+code", bad = false;
// One URL; an unknown flag, a second URL, or a bad mode is a usage error, never silently ignored
// or read as the URL. A repeated --siblings takes the last value.
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") asJson = true;
  else if (a === "--siblings") siblings = args[++i];
  else if (a.startsWith("--siblings=")) siblings = a.slice("--siblings=".length);
  else if (!a.startsWith("-") && url === undefined) url = a;
  else bad = true;
}

if (bad || !url || !PROJECTIONS.has(siblings)) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const { doc, markdown } = await run({ url, siblings });
  console.log(asJson ? JSON.stringify(doc) : markdown);
} catch (e) {
  console.error(`mdflow: ${e?.message || e}`);
  process.exit(1);
}
