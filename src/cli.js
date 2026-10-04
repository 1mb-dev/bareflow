// The mdflow CLI as a function: bin/mdflow.js passes process args, env, and streams; verify
// passes its own run() over frozen pages. Returns the exit code: 0 document on out, 2 usage
// error, 1 fetch or extraction failure with the reason on err.
import { run as pipelineRun } from "./pipeline.js";
import { logUse, useEntry } from "./uselog.js";

export const USAGE = "usage: mdflow <url> [--json]";

export async function main(args, { run = pipelineRun, env = {}, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  let url, asJson = false, bad = false;
  // One URL; an unknown flag or a second URL is a usage error, never silently ignored or read as
  // the URL.
  for (const a of args) {
    if (a === "--json") asJson = true;
    else if (!a.startsWith("-") && url === undefined) url = a;
    else bad = true;
  }
  if (bad || !url) { err(USAGE + "\n"); return 2; }
  try {
    const { doc, markdown } = await run({ url });
    const output = asJson ? JSON.stringify(doc) : markdown;
    logUse(env.MDFLOW_LOG, useEntry({ url, format: asJson ? "json" : "markdown", output, doc }));
    out(output + "\n");
    return 0;
  } catch (e) {
    logUse(env.MDFLOW_LOG, useEntry({ url, error: e }));
    err(`mdflow: ${e?.message || e}\n`);
    return 1;
  }
}
