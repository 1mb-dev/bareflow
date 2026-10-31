// The bareflow CLI as a function: bin/bareflow.js passes process args; verify passes its own run()
// over frozen pages and its own streams. Returns the exit code: 0 document on out, 2 usage
// error, 1 fetch or extraction failure with the reason on err.
import { run as pipelineRun } from "./pipeline.js";
import { convertBounded } from "./bounded.js";
import { CONVERT_TIMEOUT, MAX_BYTES, MAX_DEPTH, MAX_ELEMENTS } from "./fetch-policy.js";
import { serve } from "./mcp.js";
import { VERSION } from "./version.js";

export const USAGE = "usage: bareflow <url> [--json] | bareflow --version | bareflow mcp";

// The parse seam's refusals (src/html.js NotHtml) and the fetch cap's (fetchPage), said with
// the host and the next step.
const PARTS = "If the site also publishes it in parts, convert one part; otherwise open it in a browser.";
function refusal(e, url) {
  const host = e?.host ?? (URL.canParse(url) ? new URL(url).hostname : url);
  if (e?.code === "empty") return `no readable text came back from ${host}: a page that builds itself with JavaScript arrives empty. Open it in a browser.`;
  if (e?.code === "blank") return `${host} returned an empty page. Open it in a browser to check.`;
  if (e?.code === "not-html") return `${host} did not return an HTML page${e.shape === "json" ? " (it looks like JSON)" : ""}. Fetch it directly.`;
  if (e?.code === "too-deep") return `${host}'s page nests more than ${MAX_DEPTH} levels deep, past bareflow's limit. Open it in a browser.`;
  if (e?.code === "too-big") return `${host}'s page has more than ${MAX_ELEMENTS.toLocaleString("en-US")} elements, past bareflow's limit. ${PARTS}`;
  if (e?.code === "over-cap") return `${host}'s page is over ${MAX_BYTES / 1048576} MB, bareflow's limit. ${PARTS}`;
  if (e?.code === "slow") return `converting ${host}'s page took over ${CONVERT_TIMEOUT / 1000} seconds, bareflow's limit. Open it in a browser.`;
  if (e?.code === "memory") return `converting ${host}'s page needed more than ${e.heapMb} MB of memory, bareflow's limit. ${PARTS}`;
  return null;
}

const bounded = (o) => pipelineRun({ ...o, convert: convertBounded });

// The one path from a URL to a caller's text: the CLI prints it, fetch_doc returns it. `run` gets the
// url alone: its other params skip fetch and the SSRF checks.
async function render(url, asJson, run) {
  try {
    const { doc, markdown } = await run({ url });
    return { ok: true, text: (asJson ? JSON.stringify(doc) : markdown) + "\n" };
  } catch (e) {
    return { ok: false, text: `bareflow: ${refusal(e, url) ?? e?.message ?? e}\n` };
  }
}

// bin/bareflow.js routes `mcp` alone here.
export const mcp = ({ write, err }) => serve({ input: process.stdin, write, err, tool: (url, asJson) => render(url, asJson, bounded) });

export async function main(args, { run = bounded, out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  // --version alone; beside anything else it is a usage error, as any unknown flag is.
  if (args.length === 1 && args[0] === "--version") { out(VERSION + "\n"); return 0; }
  let url, asJson = false, bad = false;
  // One URL; an unknown flag or a second URL is a usage error, never silently ignored or read as
  // the URL.
  for (const a of args) {
    if (a === "--json") asJson = true;
    else if (!a.startsWith("-") && url === undefined) url = a;
    else bad = true;
  }
  if (bad || !url || url === "mcp") { err(USAGE + "\n"); return 2; }
  const { ok, text } = await render(url, asJson, run);
  (ok ? out : err)(text);
  return ok ? 0 : 1;
}
