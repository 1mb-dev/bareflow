#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json] [--siblings full]
import { run } from "../src/pipeline.js";

const args = process.argv.slice(2);
const at = args.indexOf("--siblings");
const siblings = at < 0 ? "headings+code" : args[at + 1];
const url = args.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
const asJson = args.includes("--json");

if (!url || (at >= 0 && siblings !== "full")) {
  console.error("usage: mdflow <url> [--json] [--siblings full]");
  process.exit(2);
}

try {
  const { doc, markdown } = await run({ url, siblings });
  console.log(asJson ? JSON.stringify(doc) : markdown);
} catch (e) {
  console.error(`mdflow: ${e?.message || e}`);
  process.exit(1);
}
