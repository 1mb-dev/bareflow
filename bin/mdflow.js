#!/usr/bin/env node
// mdflow CLI: mdflow <url> [--json]
import { run } from "../src/pipeline.js";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");

if (!url) {
  console.error("usage: mdflow <url> [--json]");
  process.exit(2);
}

try {
  const { doc, markdown } = await run({ url, config: { mode: "document" } });
  console.log(asJson ? JSON.stringify(doc, null, 2) : markdown);
} catch (e) {
  console.error(`mdflow: ${e?.message || e}`);
  process.exit(1);
}
