// The Node pipeline: fetch -> convert. Deterministic for a fixed snapshot AND pinned
// retrievedAt: same html + same version + same retrievedAt -> same document. Live fetch bakes in
// the retrieval time, so live runs differ.
import { createHash } from "node:crypto";
import { fetchSnapshot } from "./fetch.js";
import { checkUrl, convert } from "./convert.js";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function run({ url, html, retrievedAt, fetch = fetchSnapshot }) {
  checkUrl(url);
  const snap = html != null
    ? { url, finalUrl: url, html, fingerprint: sha(html), retrievedAt: retrievedAt ?? new Date().toISOString() }
    : await fetch(url);
  return convert({ url, finalUrl: snap.finalUrl, html: snap.html, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint });
}
