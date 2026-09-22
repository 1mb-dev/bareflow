// Fetch a URL into a raw HTML snapshot, SSRF-guarded and size-capped.
// The connection is pinned to a validated public address: node:https/http is given a custom
// lookup that resolves the host, rejects private/loopback/link-local addresses, and returns a
// validated IP for the actual socket. There is no second resolution, so DNS rebinding cannot
// slip a private address past the check. This is the dev-side guard; the deployed Worker also
// relies on the platform egress filter.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { isPrivateIp } from "./ssrf.js";

export const MAX_BYTES = 5 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

// Decompress a capped body, capping the decompressed output too: a small compressed stream
// inflates far past MAX_BYTES, so the sync decoders get a maxOutputLength that throws before
// the bomb allocates. On failure the raw body is returned (the caller's fingerprint still sees it).
export function decompress(body, enc) {
  try {
    if (enc.includes("gzip")) return gunzipSync(body, { maxOutputLength: MAX_BYTES });
    if (enc.includes("deflate")) return inflateSync(body, { maxOutputLength: MAX_BYTES });
    if (enc.includes("br")) return brotliDecompressSync(body, { maxOutputLength: MAX_BYTES });
  } catch { /* decode failed or output exceeded the cap: keep raw */ }
  return body;
}

function validatingLookup(hostname, opts, cb) {
  lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const pub = addrs.filter((a) => !isPrivateIp(a.address));
    if (!pub.length) return cb(new Error(`blocked address for ${hostname}`));
    // Node >=24 resolves with all:true and expects an array of {address, family} back.
    if (opts?.all) cb(null, pub.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, pub[0].address, pub[0].family);
  });
}

function rawFetch(url, timeout, depth = 0) {
  if (depth > 5) return Promise.reject(new Error("too many redirects"));
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  if (!isHttps && u.protocol !== "http:") return Promise.reject(new Error(`unsupported protocol: ${u.protocol}`));
  // Literal-IP hostnames skip the lookup callback, so reject private ones up front.
  if (isIP(u.hostname) !== 0 && isPrivateIp(u.hostname)) return Promise.reject(new Error(`blocked address for ${u.hostname}`));
  const req = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const r = req({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      lookup: validatingLookup,
      headers: { "user-agent": UA, "accept": "text/html", "accept-language": "en-US,en;q=0.9", "accept-encoding": "gzip, deflate, br" },
    }, (res) => {
      res.on("error", reject); // mid-body abort must reject, not crash the process
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error(`redirect ${res.statusCode} without location`));
        return rawFetch(new URL(loc, url).toString(), timeout, depth + 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }

      const chunks = [];
      let size = 0;
      res.on("data", (c) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
      res.on("end", () => {
        const body = decompress(Buffer.concat(chunks).subarray(0, MAX_BYTES), (res.headers["content-encoding"] || "").toLowerCase());
        resolve({ status: res.statusCode, contentType: res.headers["content-type"] || "", finalUrl: res.responseUrl || url, body });
      });
    });
    r.setTimeout(timeout, () => r.destroy(new Error("timeout")));
    r.on("error", reject);
    r.end();
  });
}

export async function fetchSnapshot(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const timeout = opts.timeout ?? 30000;
  const { status, contentType, finalUrl, body } = await rawFetch(url, timeout);
  const html = body.subarray(0, maxBytes).toString("utf8");
  return {
    url,
    finalUrl,
    status,
    contentType,
    bytes: body.length,
    html,
    fingerprint: sha(body.subarray(0, maxBytes)),
    retrievedAt: new Date().toISOString(),
  };
}
