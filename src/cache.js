// Versioned, stale-first document cache over a KV store (Cloudflare KV interface).
// The cache key hashes the full output-affecting tuple: url + mdflow version + extractor
// version. A change to any of them invalidates the cache.
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function cacheKey(url, version, extractorVersion) {
  return `mdflow:${version}:${sha(`${url}\u0000${extractorVersion}`)}`;
}

export async function getCached(kv, key) {
  try { return (await kv.get(key, "json")) ?? null; } catch { return null; }
}

export async function putCached(kv, key, value, ttlSeconds) {
  try { await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds }); } catch { /* cache is best-effort */ }
}
