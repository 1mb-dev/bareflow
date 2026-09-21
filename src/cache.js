// Versioned, stale-first document cache over a KV store (Cloudflare KV interface).
// The cache key includes the mdflow version and config, so a version or config change
// invalidates the cache. Values carry the retrieval timestamp for stale-first serving.
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function cacheKey(url, version, config = {}) {
  return `mdflow:${version}:${sha(url + "\u0000" + JSON.stringify(config))}`;
}

export async function getCached(kv, key) {
  try { return (await kv.get(key, "json")) ?? null; } catch { return null; }
}

export async function putCached(kv, key, value, ttlSeconds) {
  try { await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds }); } catch { /* cache is best-effort */ }
}
