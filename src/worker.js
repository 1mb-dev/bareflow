// The agent-facing HTTP boundary: a Worker handler that serves the pipeline as Markdown or
// the typed IR (JSON), cached in KV (versioned, read-through, stale-first). This is the agent
// surface; it is not a reader. Deterministic for a pinned snapshot; live fetch records
// retrieval time.
import { run, VERSION } from "./pipeline.js";
import { cacheKey, getCached, putCached } from "./cache.js";

const TTL = 3600; // fresh cache: 1 hour
const STALE_TTL = 30 * 24 * 3600; // last-good fallback: 30 days

function respond(body, status, headers) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
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
  if (!target) return respond("mdflow: missing url\n", 400);
  const wantJson = u.searchParams.get("format") === "json" || (request.headers.get("accept") || "").includes("json");
  const body = (v) => (wantJson ? JSON.stringify(v.doc) : v.markdown);

  const key = cacheKey(target, VERSION);
  const fresh = await getCached(kv, key);
  if (fresh) {
    return respond(body(fresh), 200, { "x-mdflow-cache": "hit", "x-mdflow-retrieved-at": fresh.retrievedAt });
  }

  try {
    const { doc, markdown, snapshot } = await runImpl({ url: target });
    const value = { doc, markdown, retrievedAt: snapshot.retrievedAt, fingerprint: snapshot.fingerprint };
    await putCached(kv, key, value, TTL);
    await putCached(kv, `${key}:stale`, value, STALE_TTL);
    return respond(body(value), 200, { "x-mdflow-cache": "miss", "x-mdflow-fingerprint": snapshot.fingerprint });
  } catch (err) {
    const stale = await getCached(kv, `${key}:stale`);
    if (stale) {
      return respond(body(stale), 200, { "x-mdflow-cache": "hit-stale", "x-mdflow-retrieved-at": stale.retrievedAt });
    }
    return respond(`mdflow: ${err?.message || err}\n`, 502);
  }
}

export default { async fetch(request, env) { return handle(request, env); } };
