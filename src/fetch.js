// Fetch a URL into a raw HTML snapshot, SSRF-guarded and size-capped.
// The connection is pinned to a validated public address: node:https/http is given a custom
// lookup that resolves the host, rejects private/loopback/link-local addresses, and returns a
// validated IP for the actual socket. There is no second resolution, so DNS rebinding cannot
// slip a private address past the check.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { createHash } from "node:crypto";
import { isPrivateIp } from "./ssrf.js";

export const MAX_BYTES = 5 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

// Decompress a capped body, streaming so the decompressed output is also capped at MAX_BYTES
// without allocating a bomb: the first MAX_BYTES of HTML are returned and the rest discarded.
// Corrupt data keeps the raw body (pre-existing behavior).
export function decompress(body, enc) {
  const factory = enc.includes("gzip") ? createGunzip : enc.includes("deflate") ? createInflate : enc.includes("br") ? createBrotliDecompress : null;
  if (!factory) return Promise.resolve(body);
  return new Promise((resolve) => {
    const dec = factory();
    const chunks = [];
    let size = 0;
    dec.on("data", (c) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
    dec.on("end", () => resolve(Buffer.concat(chunks).subarray(0, MAX_BYTES)));
    dec.on("error", () => resolve(body));
    dec.end(body);
  });
}

function validatingLookup(hostname, opts, cb) {
  lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const pub = addrs.filter((a) => !isPrivateIp(a.address));
    if (!pub.length) return cb(new Error(`blocked address for ${hostname}: mdflow fetches public addresses only`));
    // Node >=24 resolves with all:true and expects an array of {address, family} back.
    if (opts?.all) cb(null, pub.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, pub[0].address, pub[0].family);
  });
}

// One time budget for the whole fetch, redirects included: a hard deadline, not a socket idle
// timeout, so a server that drips bytes or chains slow redirects cannot hold the caller.
function rawFetch(url, deadline, budget, resolver, depth = 0) {
  if (depth > 5) return Promise.reject(new Error(`more than 5 redirects from ${url}`));
  let u;
  try { u = new URL(url); } catch { return Promise.reject(new Error(`not a URL: ${url}; give a full http(s) URL`)); }
  const isHttps = u.protocol === "https:";
  if (!isHttps && u.protocol !== "http:") return Promise.reject(new Error(`unsupported protocol ${u.protocol} in ${url}; give an http(s) URL`));
  // Literal-IP hostnames skip the lookup callback, so reject private ones up front. URL keeps
  // an IPv6 literal's brackets ("[::1]"), which isIP and the socket both reject.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0 && isPrivateIp(host)) return Promise.reject(new Error(`blocked address for ${host}: mdflow fetches public addresses only`));
  const req = isHttps ? httpsRequest : httpRequest;
  const left = deadline - Date.now();
  if (left <= 0) return Promise.reject(new Error(`no answer from ${url} within ${budget} ms (redirects included); retry, or open it in a browser`));

  return new Promise((resolve, reject) => {
    let timer;
    const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
    resolve = done(resolve); reject = done(reject);
    const r = req({
      protocol: u.protocol,
      hostname: host,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      lookup: resolver,
      headers: { "user-agent": UA, "accept": "text/html", "accept-language": "en-US,en;q=0.9", "accept-encoding": "gzip, deflate, br" },
    }, (res) => {
      res.on("error", reject); // mid-body abort must reject, not crash the process
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const loc = res.headers.location;
        res.resume();
        if (!loc) return reject(new Error(`redirect ${res.statusCode} without a location from ${url}`));
        clearTimeout(timer);
        return rawFetch(new URL(loc, url).toString(), deadline, budget, resolver, depth + 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} from ${url}; check the URL (mdflow does not retry)`)); }

      const chunks = [];
      let size = 0;
      res.on("data", (c) => { size += c.length; if (size <= MAX_BYTES) chunks.push(c); });
      res.on("end", async () => {
        const body = await decompress(Buffer.concat(chunks).subarray(0, MAX_BYTES), (res.headers["content-encoding"] || "").toLowerCase());
        resolve({ status: res.statusCode, contentType: res.headers["content-type"] || "", finalUrl: res.responseUrl || url, body });
      });
    });
    timer = setTimeout(() => r.destroy(new Error(`no answer from ${url} within ${budget} ms (redirects included); retry, or open it in a browser`)), left);
    r.on("error", reject);
    r.end();
  });
}

// opts.timeout: the total budget in ms (default 30 s). opts.lookup replaces the SSRF-validating
// resolver and exists for verify's local test servers only; nothing else may pass it.
export async function fetchSnapshot(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const budget = opts.timeout ?? 30000;
  const { status, contentType, finalUrl, body } = await rawFetch(url, Date.now() + budget, budget, opts.lookup ?? validatingLookup);
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
