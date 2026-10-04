#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json]. Set MDFLOW_LOG=<file> to append one JSON line per use.
import { run } from "../src/pipeline.js";
import { logUse, useEntry } from "../src/uselog.js";

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

const log = process.env.MDFLOW_LOG;
try {
  const { doc, markdown } = await run({ url });
  const output = asJson ? JSON.stringify(doc) : markdown;
  logUse(log, useEntry({ url, format: asJson ? "json" : "markdown", output, doc }));
  console.log(output);
} catch (e) {
  logUse(log, useEntry({ url, error: e }));
  console.error(`mdflow: ${e?.message || e}`);
  process.exit(1);
}
