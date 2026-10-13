// The bareflow CLI as a function: bin/bareflow.js passes process args; verify passes its own run()
// over frozen pages and its own streams. Returns the exit code: 0 document on out, 2 usage
// error, 1 fetch or extraction failure with the reason on err.
import { run as pipelineRun } from "./pipeline.js";

export const USAGE = "usage: bareflow <url> [--json]";

// The parse seam's refusals (src/html.js NotHtml), said with the host and the next step.
function refusal(e, url) {
  const host = URL.canParse(url) ? new URL(url).host : url;
  if (e?.code === "blank") return `${host} returned nothing. Open it in a browser to check.`;
  if (e?.code === "not-html") return `${host} did not return an HTML page${e.shape === "json" ? " (it looks like JSON)" : ""}. Fetch it directly.`;
  return null;
}

export async function main(args, { run = pipelineRun, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
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
    out(output + "\n");
    return 0;
  } catch (e) {
    err(`bareflow: ${refusal(e, url) ?? e?.message ?? e}\n`);
    return 1;
  }
}
