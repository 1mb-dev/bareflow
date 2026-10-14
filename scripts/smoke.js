// A deployed site against the build that deployed it: what the platform adds (routing, headers, the
// Function), never the content verify already proves. The build is dist/site, byte for byte, sitekey
// included: against a deploy, run it in the job that built and deployed, after the deploy.
//   node scripts/smoke.js [base] [--preview <host>] [--burst <n>]
// base defaults to https://bareflow.1mb.dev. Before 6.5, locally (wrangler takes functions/ from the
// cwd; wrangler 4.67.0):
//   npm run site && wrangler pages dev dist/site --ip 127.0.0.1 --port 8788 \
//     --binding TURNSTILE_SECRET=1x0000000000000000000000000000000AA
//   node scripts/smoke.js http://127.0.0.1:8788
// Every /_fetch request spends account-wide Workers quota: one per run, --burst up to n more.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_SITEKEY } from "./site.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist/site");
const SHARE = "/https://docs.deno.com/runtime/reference/cli/add/";
const SETTLE = 120000, POLL = 5000;

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args.splice(i, 2)[1]; };
const preview = flag("--preview"), burst = flag("--burst");
const base = new URL(args[0] ?? "https://bareflow.1mb.dev");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
if (burst && local) throw new Error("--burst needs a deployed host: there is no rate rule locally");

const built = async (f) => readFile(join(DIST, f));
const home = await built("_app/home.html");
if (!local && home.includes(TEST_SITEKEY)) throw new Error("dist/site was built with the test sitekey, so no deploy serves it: build with the deploy's TURNSTILE_SITEKEY, or run this in the deploy job");
const shell = await built("index.html"), privacy = await built("privacy.html"), robots = await built("robots.txt");
// The /* block of _headers: an unindented line names a path, indented lines are its headers.
const HEADERS = [];
let block;
for (const line of (await readFile(join(DIST, "_headers"), "utf8")).split("\n")) {
  if (/^\S/.test(line)) block = line.trim();
  else if (block === "/*" && line.includes(":")) { const at = line.indexOf(":"); HEADERS.push([line.slice(0, at).trim(), line.slice(at + 1).trim()]); }
}

const get = (path, init) => fetch(new URL(path, base), { redirect: "manual", ...init });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());
let failed = 0;
const row = (ok, name, saw) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"}  ${name}${saw ? `: ${saw}` : ""}`); };

// Settle on identity: a fresh deploy serves the previous one (or none) for a while; a row retried
// until green would hide one that flaps between the two.
const start = Date.now();
for (let n = 1; ; n++) {
  const r = await get("/").catch((e) => e);
  if (r instanceof Response && r.status === 200 && (await bytes(r)).equals(home)) { console.log(`ok    settled: / is this build (${n} tries)`); break; }
  if (Date.now() - start > SETTLE) { console.log(`FAIL  settled: / is not this build after ${SETTLE / 1000} s (${r instanceof Response ? r.status : r.message})`); process.exit(1); }
  await new Promise((ok) => setTimeout(ok, POLL));
}

for (const [path, want, name] of [["/", home, "home"], ["/privacy", privacy, "privacy page"], [SHARE, shell, "shell"], ["/_app/home", home, "home"], ["/robots.txt", robots, "robots.txt"]]) {
  const r = await get(path);
  const same = r.status === 200 && (await bytes(r)).equals(want);
  row(same, `${path} is the built ${name}`, same ? "" : `${r.status} ${r.headers.get("content-type")}`);
  if (path === "/robots.txt") continue;
  const off = HEADERS.filter(([k, v]) => r.headers.get(k) !== v).map(([k]) => k);
  const robotsTag = base.hostname.endsWith(".pages.dev") ? null : r.headers.get("x-robots-tag");
  row(!off.length && !robotsTag, `${path} carries _headers' /* values${base.hostname.endsWith(".pages.dev") ? "" : ", no X-Robots-Tag"}`, [off.length ? `missing or changed ${off.join(", ")}` : "", robotsTag ? `x-robots-tag ${robotsTag}` : ""].filter(Boolean).join("; "));
}

// The Function, tokenless: refused before any fetch or siteverify call, inert where it lands.
{
  const r = await get(`/_fetch?url=${encodeURIComponent("https://example.com/")}`);
  const h = r.headers;
  const ok = r.status === 403 && h.get("x-bareflow-error") === "token" && h.get("x-content-type-options") === "nosniff" &&
    h.get("content-security-policy") === "sandbox; default-src 'none'" && h.get("cache-control") === "no-store" && !h.has("access-control-allow-origin");
  row(ok, "/_fetch without a token: 403 token, inert, no CORS", ok ? "" : `${r.status} ${h.get("x-bareflow-error")} ${h.get("content-type")}`);
}

// A preview is behind Cloudflare Access: its /_fetch answers Access's redirect, not the Function.
if (preview) {
  const r = await fetch(`https://${preview}/_fetch?url=${encodeURIComponent("https://example.com/")}`, { redirect: "manual" });
  const to = r.headers.get("location") ? new URL(r.headers.get("location")).hostname : "";
  row(r.status === 302 && to.endsWith(".cloudflareaccess.com") && !r.headers.has("x-bareflow-error"), `${preview}/_fetch is behind Access`, `${r.status} ${to}`);
}

// Recorded, never failed: what the production pages.dev host does (a 6.4 decision).
if (!local) {
  const r = await fetch("https://bareflow.pages.dev/", { redirect: "manual" }).catch((e) => e);
  console.log(`note  bareflow.pages.dev: ${r instanceof Response ? `${r.status} ${r.headers.get("location") ? new URL(r.headers.get("location")).hostname : ""}` : r.message}`);
}

// Last: a hit blocks this IP for the rule's period. The Function never answers 429.
if (burst) {
  let limited = 0, sent = 0;
  for (; sent < Number(burst) && !limited; sent++) {
    const r = await get(`/_fetch?url=${encodeURIComponent("https://example.com/")}`);
    if (r.status === 429 && !r.headers.has("x-bareflow-error")) limited = sent + 1;
    await r.body?.cancel();
  }
  row(limited > 0, `tokenless /_fetch burst meets the rate rule`, limited ? `429 at request ${limited}` : `no 429 in ${sent}`);
}

console.log(failed ? `${failed} failed` : "all rows ok");
process.exit(failed ? 1 : 0);
