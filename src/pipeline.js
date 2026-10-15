// The Node pipeline: fetch, then convert. A live fetch bakes in the retrieval time, so live runs
// differ; html and retrievedAt given (verify's frozen pages) make it deterministic.
import { fetchSnapshot } from "./fetch.js";
import { httpUrl, MAX_BYTES } from "./fetch-policy.js";

// The converter loads only when no other is given: the CLI converts in a thread (src/bounded.js).
export async function run({ url, html, retrievedAt, fetch = fetchSnapshot, convert: given }) {
  httpUrl(url);
  const conv = given ?? (await import("./convert.js")).convert;
  if (html != null) return conv({ url, html, retrievedAt: retrievedAt ?? new Date().toISOString(), input: "fetch" });
  const snap = await fetch(url);
  // A page cut at the cap would convert with its last block silently partial: refused, as the web does.
  if (snap.over) throw Object.assign(new Error(`the page is over the ${MAX_BYTES / 1048576} MB cap`), { code: "over-cap", host: new URL(snap.finalUrl).hostname });
  return conv({ url, finalUrl: snap.finalUrl, html: snap.html, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint, input: "fetch" });
}
