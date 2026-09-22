// The agent-facing HTTP boundary: a Worker handler that serves the pipeline as Markdown or
// the typed IR (JSON), cached in KV (versioned, read-through, stale-first). This is the agent
// surface, not a reader. Dev runtime: the fetch layer is Node-only today; the CF fetch swap
// is the next commit. Deterministic for a pinned snapshot; live fetch records retrieval time.
import { run, VERSION } from "./pipeline.js";
import { EXTRACTOR_VERSION } from "./extract.js";
import { cacheKey, getCached, putCached } from "./cache.js";
import { isPrivateIp } from "./ssrf.js";

const TTL = 3600; // fresh cache: 1 hour
const STALE_TTL = 30 * 24 * 3600; // last-good fallback: 30 days

function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("invalid url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`unsupported protocol: ${u.protocol}`);
  // hostname keeps IPv6 brackets in this runtime; strip them before the literal-IP check.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isPrivateIp(host)) throw new Error(`blocked address: ${host}`);
  return u;
}

function wantsJson(accept) {
  if (!accept) return false;
  return accept.split(",").some((part) => {
    const [mt, ...params] = part.trim().split(";");
    const q = params.find((p) => p.trim().toLowerCase().startsWith("q="));
    if (q && parseFloat(q.split("=")[1]) === 0) return false;
    return mt === "application/json" || mt.endsWith("+json");
  });
}

function respond(body, status, json, headers) {
  return new Response(body, {
    status,
    headers: {
      "content-type": json ? "application/json" : "text/plain; charset=utf-8",
      "access-control-allow-origin": "*",
      "x-mdflow-version": VERSION,
      ...headers,
    },
  });
}

export async function handle(request, env, deps = {}) {
  const runImpl = deps.run || run;
  const kv = deps.kv || env.MDFLOW_KV;
  const u = new URL(request.url);
  const target = u.searchParams.get("url") || u.pathname.slice(1);

  let fmt = (u.searchParams.get("format") || "").toLowerCase();
  const json = fmt === "json" || (fmt === "" && wantsJson(request.headers.get("accept")));
  if (fmt && fmt !== "json" && fmt !== "markdown") fmt = "markdown";

  const error = (msg, code) => (json ? respond(JSON.stringify({ error: msg, code }), code, true) : respond(`mdflow: ${msg}\n`, code, false));
  if (!target) return error("missing url", 400);
  let safe;
  try { safe = assertSafeUrl(target); } catch (e) { return error(e.message, 400); }

  const key = cacheKey(safe.toString(), VERSION, EXTRACTOR_VERSION);
  const fresh = await getCached(kv, key);
  if (fresh) {
    return respond(json ? JSON.stringify(fresh.doc) : fresh.markdown, 200, json, { "x-mdflow-cache": "hit", "x-mdflow-retrieved-at": fresh.retrievedAt });
  }

  try {
    const { doc, markdown, snapshot } = await runImpl({ url: safe.toString() });
    const value = { doc, markdown, retrievedAt: snapshot.retrievedAt };
    await putCached(kv, key, value, TTL);
    await putCached(kv, `${key}:stale`, value, STALE_TTL);
    return respond(json ? JSON.stringify(doc) : markdown, 200, json, { "x-mdflow-cache": "miss", "x-mdflow-retrieved-at": snapshot.retrievedAt });
  } catch (err) {
    const stale = await getCached(kv, `${key}:stale`);
    if (stale) {
      return respond(json ? JSON.stringify(stale.doc) : stale.markdown, 200, json, { "x-mdflow-cache": "hit-stale", "x-mdflow-retrieved-at": stale.retrievedAt });
    }
    return error(err?.message || String(err), 502);
  }
}

export default { async fetch(request, env) { return handle(request, env); } };
