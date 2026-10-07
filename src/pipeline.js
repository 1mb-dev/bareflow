// The Node pipeline: fetch -> convert. Deterministic for a fixed snapshot AND pinned
// retrievedAt: same html + same version + same retrievedAt -> same document. Live fetch bakes in
// the retrieval time, so live runs differ.
import { sha256 } from "./sha256.js";
import { fetchSnapshot } from "./fetch.js";
import { checkUrl, convert } from "./convert.js";

export async function run({ url, html, retrievedAt, fetch = fetchSnapshot }) {
  checkUrl(url);
  const snap = html != null
    ? { url, finalUrl: url, html, fingerprint: sha256(html).slice(0, 16), retrievedAt: retrievedAt ?? new Date().toISOString() }
    : await fetch(url);
  return convert({ url, finalUrl: snap.finalUrl, html: snap.html, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint });
}
