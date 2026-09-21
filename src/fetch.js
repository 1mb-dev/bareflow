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

export const MAX_BYTES = 5 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT
  /^198\.18\./, /^198\.51\.100\./, /^203\.0\.113\./,
];
const PRIVATE_V6 = [/^::1$/, /^::$/, /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i];

// IPv4-mapped and IPv4-compatible IPv6 are evaluated as their embedded IPv4 address.
function normalizeIp(ip) {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i) || ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}
function isPrivateIp(ip) {
  const n = normalizeIp(ip);
  if (isIP(n) === 0) return true;
  if (n.includes(":")) return PRIVATE_V6.some((re) => re.test(n.toLowerCase()));
  return PRIVATE_V4.some((re) => re.test(n));
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
        let body = Buffer.concat(chunks).subarray(0, MAX_BYTES);
        const enc = (res.headers["content-encoding"] || "").toLowerCase();
        try {
          if (enc.includes("gzip")) body = gunzipSync(body);
          else if (enc.includes("deflate")) body = inflateSync(body);
          else if (enc.includes("br")) body = brotliDecompressSync(body);
        } catch { /* keep raw if decode fails */ }
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
