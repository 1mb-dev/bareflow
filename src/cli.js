// The bareflow CLI as a function: bin/bareflow.js passes process args; verify passes its own run()
// over frozen pages and its own streams. Returns the exit code: 0 document on out, 2 usage
// error, 1 fetch or extraction failure with the reason on err.
import { run as pipelineRun } from "./pipeline.js";
import { convertBounded } from "./bounded.js";
import { CONVERT_TIMEOUT, MAX_DEPTH, MAX_ELEMENTS } from "./fetch-policy.js";

export const USAGE = "usage: bareflow <url> [--json]";

// The parse seam's refusals (src/html.js NotHtml), said with the host and the next step.
function refusal(e, url) {
  const host = e?.host ?? (URL.canParse(url) ? new URL(url).hostname : url);
  if (e?.code === "blank") return `${host} returned nothing. Open it in a browser to check.`;
  if (e?.code === "not-html") return `${host} did not return an HTML page${e.shape === "json" ? " (it looks like JSON)" : ""}. Fetch it directly.`;
  if (e?.code === "too-deep") return `${host}'s page nests more than ${MAX_DEPTH} levels deep, past bareflow's limit. Open it in a browser.`;
  if (e?.code === "too-big") return `${host}'s page has more than ${MAX_ELEMENTS.toLocaleString("en-US")} elements, past bareflow's limit. Open it in a browser.`;
  if (e?.code === "slow") return `converting ${host}'s page took over ${CONVERT_TIMEOUT / 1000} seconds, bareflow's limit. Open it in a browser.`;
  return null;
}

export async function main(args, { run = (o) => pipelineRun({ ...o, convert: convertBounded }), out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
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
