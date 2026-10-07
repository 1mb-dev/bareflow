// The Node pipeline: fetch -> convert. Deterministic for a fixed snapshot AND pinned
// retrievedAt: same html + same version + same retrievedAt -> same document. Live fetch bakes in
// the retrieval time, so live runs differ.
import { fetchSnapshot } from "./fetch.js";
import { convert } from "./convert.js";
import { httpUrl } from "./fetch-policy.js";

export async function run({ url, html, retrievedAt, fetch = fetchSnapshot }) {
  httpUrl(url);
  if (html != null) return convert({ url, html, retrievedAt: retrievedAt ?? new Date().toISOString(), input: "fetch" });
  const snap = await fetch(url);
  return convert({ url, finalUrl: snap.finalUrl, html: snap.html, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint, input: "fetch" });
}
