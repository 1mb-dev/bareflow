// A deployed site against the build that deployed it: what the platform adds (routing, headers, the
// Function), never the content verify already proves. The build is dist/site, byte for byte, sitekey
// included, less the scripts Cloudflare appends to an HTML page (scripts/injected.js): against a deploy,
// run it in the job that built and deployed, after the deploy.
//   node scripts/smoke.js [base] [--preview <host>] [--burst <n>]
//   node scripts/smoke.js [base] --probe    the tokenless /_fetch row alone, no build (probe.yml, hourly)
// base defaults to https://bareflow.1mb.dev. Locally (wrangler takes functions/ from the cwd; wrangler
// 4.67.0; parallel instances need distinct --inspector-port):
//   npm run site && wrangler pages dev dist/site --ip 127.0.0.1 --port 8788 \
//     --binding TURNSTILE_SECRET=1x0000000000000000000000000000000AA
//   node scripts/smoke.js http://127.0.0.1:8788
// Every /_fetch request spends account-wide Workers quota: one per run, --burst up to n more.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lessInjected } from "./injected.js";
import { TEST_SITEKEYS } from "./sitekey.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/site");
const SHARE = "/https://docs.deno.com/runtime/reference/cli/add/";
const SETTLE = 120000, POLL = 5000, REQUEST = 15000;
const USAGE = "usage: node scripts/smoke.js [base] [--preview <host>] [--burst <n>] | [base] --probe";

const args = process.argv.slice(2), opts = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) continue;
  if (args[i] === "--probe") { opts.probe = true; args.splice(i--, 1); continue; }
  const [name, value] = [args[i], args[i + 1]];
  if (!["--preview", "--burst"].includes(name) || !value || value.startsWith("--")) throw new Error(`${name}: ${USAGE}`);
  opts[name.slice(2)] = value;
  args.splice(i--, 2);
}
if (args.length > 1 || (opts.probe && (opts.preview || opts.burst))) throw new Error(USAGE);
if (opts.burst !== undefined && !(Number.isInteger(Number(opts.burst)) && Number(opts.burst) > 0)) throw new Error(`--burst takes a count: ${USAGE}`);
const base = new URL(args[0] ?? "https://bareflow.1mb.dev");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), pagesDev = base.hostname.endsWith(".pages.dev");
// The rate rule lives in the 1mb.dev zone only: anywhere else a burst spends quota and meets nothing.
if (opts.burst && !(base.hostname === "1mb.dev" || base.hostname.endsWith(".1mb.dev"))) throw new Error(`--burst needs a host in the 1mb.dev zone, where the rate rule is; ${base.hostname} has none`);

// Each request is bounded: the settle deadline is read between requests, so one that never answers
// would outlast it.
const get = (url) => fetch(new URL(url, base), { redirect: "manual", signal: AbortSignal.timeout(REQUEST) });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());
const hostOf = (res, url) => (res.headers.get("location") ? new URL(res.headers.get("location"), url).hostname : "");
let failed = 0;
const row = (ok, name, saw) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${name}${saw ? `: ${saw}` : ""}`); };
// A request that fails outright is that row's FAIL, never the end of the run.
const check = async (name, fn) => { try { await fn(); } catch (e) { row(false, name, e.cause?.message ?? e.message); } };
const done = () => { console.log(failed ? `${failed} failed` : "all rows ok"); process.exit(failed ? 1 : 0); };

// The Function, tokenless: refused before any fetch or siteverify call, inert where it lands. Alone
// (--probe), it is what a quota spent, a fail-open route, a broken deploy, or DNS changes.
const tokenless = () => check("/_fetch without a token", async () => {
  const r = await get(`/_fetch?url=${encodeURIComponent("https://example.com/")}`);
  const h = r.headers;
  const ok = r.status === 403 && h.get("x-bareflow-error") === "token" && h.get("x-content-type-options") === "nosniff" &&
    h.get("content-security-policy") === "sandbox; default-src 'none'" && h.get("cache-control") === "no-store" && !h.has("access-control-allow-origin");
  row(ok, "/_fetch without a token: 403 token, inert, no CORS", ok ? "" : `${r.status} ${h.get("x-bareflow-error")} ${h.get("content-type")}`);
});
if (opts.probe) { await tokenless(); done(); }

const built = async (f) => readFile(join(DIST, f));
const home = await built("_app/home.html");
if (!local && [...TEST_SITEKEYS].some((k) => home.includes(k))) throw new Error("dist/site was built with a test sitekey, so no deploy serves it: build with the deploy's TURNSTILE_SITEKEY, or run this in the deploy job");
const shell = await built("index.html"), privacy = await built("privacy.html"), robots = await built("robots.txt"), worker = await built("_app/worker.js");
// The /* block of _headers: an unindented line names a path, indented lines are its headers.
const HEADERS = [];
let block;
for (const line of (await readFile(join(DIST, "_headers"), "utf8")).split("\n")) {
  if (/^\S/.test(line)) block = line.trim();
  else if (block === "/*" && line.includes(":")) { const at = line.indexOf(":"); HEADERS.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]); }
}
if (!HEADERS.length) throw new Error("dist/site/_headers has no /* headers to check");

// Settle on identity: a fresh deploy serves the previous one (or none) for a while; a row retried
// until green would hide one that flaps between the two.
const start = Date.now();
for (let n = 1; ; n++) {
  let r, same = false;
  try { r = await get("/"); same = r.status === 200 && lessInjected(await bytes(r)).equals(home); } catch (e) { r = e; }
  if (same) { console.log(`ok    settled: / is this build (${n} tries)`); break; }
  if (Date.now() - start > SETTLE) { console.log(`FAIL  settled: / is not this build after ${SETTLE / 1000} s (${r instanceof Response ? r.status : r.cause?.message ?? r.message})`); process.exit(1); }
  await new Promise((ok) => setTimeout(ok, POLL));
}

// The worker is fetched by script: a wrong type would be refused (nosniff) as a module of no use.
for (const [path, want, name, type, less] of [["/", home, "home", null, lessInjected], ["/privacy", privacy, "privacy page", null, lessInjected], [SHARE, shell, "shell", null, lessInjected], ["/_app/home", home, "home", null, lessInjected], ["/robots.txt", robots, "robots.txt"],
  ["/_app/worker.js", worker, "worker", /^(text|application)\/javascript\b/]]) {
  await check(`${path} is the built ${name}`, async () => {
    const r = await get(path);
    const got = await bytes(r), same = r.status === 200 && (less ? less(got) : got).equals(want) && (!type || type.test(r.headers.get("content-type") ?? ""));
    row(same, `${path} is the built ${name}${type ? ", served as JavaScript" : ""}`, same ? "" : `${r.status} ${r.headers.get("content-type")}`);
    if (path === "/robots.txt") return;
    // pages.dev hosts carry _headers' noindex rule; any other host must not.
    const off = HEADERS.filter(([k, v]) => r.headers.get(k) !== v).map(([k]) => k), tag = r.headers.get("x-robots-tag");
    const tagOk = pagesDev ? tag === "noindex" : tag === null;
    row(!off.length && tagOk, `${path} carries _headers' /* values, ${pagesDev ? "X-Robots-Tag noindex" : "no X-Robots-Tag"}`,
      [off.length ? `missing or changed ${off.join(", ")}` : "", tagOk ? "" : `x-robots-tag ${tag}`].filter(Boolean).join("; "));
  });
}

await tokenless();

// A preview is behind Cloudflare Access: its /_fetch answers Access's redirect, not the Function.
if (opts.preview) {
  await check(`${opts.preview}/_fetch is behind Access`, async () => {
    const url = `https://${opts.preview}/_fetch?url=${encodeURIComponent("https://example.com/")}`, r = await get(url), to = hostOf(r, url);
    row(r.status === 302 && to.endsWith(".cloudflareaccess.com") && !r.headers.has("x-bareflow-error"), `${opts.preview}/_fetch is behind Access`, `${r.status} ${to}`);
  });
}

// Printed, never failed: what the production pages.dev host answers.
if (!local) {
  const url = "https://bareflow.pages.dev/", r = await get(url).catch((e) => e);
  console.log(`note  bareflow.pages.dev: ${r instanceof Response ? `${r.status} ${hostOf(r, url)}` : r.cause?.message ?? r.message}`);
}

// Last: a hit blocks this IP for the rule's period. The Function never answers 429.
if (opts.burst) {
  await check("tokenless /_fetch burst meets the rate rule", async () => {
    let limited = 0, sent = 0;
    for (; sent < Number(opts.burst) && !limited; sent++) {
      const r = await get(`/_fetch?url=${encodeURIComponent("https://example.com/")}`);
      if (r.status === 429 && !r.headers.has("x-bareflow-error")) limited = sent + 1;
      await r.body?.cancel();
    }
    row(limited > 0, "tokenless /_fetch burst meets the rate rule", limited ? `429 at request ${limited}` : `no 429 in ${sent}`);
  });
}

done();
