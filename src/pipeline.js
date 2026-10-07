// The Node pipeline: fetch, then convert. A live fetch bakes in the retrieval time, so live runs
// differ; html and retrievedAt given (verify's frozen pages) make it deterministic.
import { fetchSnapshot } from "./fetch.js";
import { convert } from "./convert.js";
import { httpUrl } from "./fetch-policy.js";

export async function run({ url, html, retrievedAt, fetch = fetchSnapshot }) {
  httpUrl(url);
  if (html != null) return convert({ url, html, retrievedAt: retrievedAt ?? new Date().toISOString(), input: "fetch" });
  const snap = await fetch(url);
  return convert({ url, finalUrl: snap.finalUrl, html: snap.html, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint, input: "fetch" });
}
