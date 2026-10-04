#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json]
import { run } from "../src/pipeline.js";

const USAGE = "usage: mdflow <url> [--json]";
const args = process.argv.slice(2);
let url, asJson = false, bad = false;
// One URL; an unknown flag or a second URL is a usage error, never silently ignored or read as
// the URL.
for (const a of args) {
  if (a === "--json") asJson = true;
  else if (!a.startsWith("-") && url === undefined) url = a;
  else bad = true;
}

if (bad || !url) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const { doc, markdown } = await run({ url });
  console.log(asJson ? JSON.stringify(doc) : markdown);
} catch (e) {
  console.error(`mdflow: ${e?.message || e}`);
  process.exit(1);
}
