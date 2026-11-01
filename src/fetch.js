// The CLI's transport for the fetch policy (fetch-policy.js): one request over node:http(s),
// SSRF-guarded and size-capped. The connection is pinned to a validated public address:
// node:https/http is given a custom lookup that resolves the host, rejects private/loopback/
// link-local addresses, and returns a validated IP for the actual socket. There is no second
// resolution, so DNS rebinding cannot slip a private address past the check.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { isPrivateIp } from "./ssrf.js";
import { blocked, fetchPage, MAX_BYTES, noAnswer, REDIRECT } from "./fetch-policy.js";

// Decompress a capped body, streaming so the decompressed output is also capped at limit:
// the decompressor is destroyed at the cap, so a bomb costs at most limit bytes of output and the
// CPU to make it, not the whole expansion. Corrupt data rejects, unless bareflow cut the body at
// the cap (truncated): then what decoded so far is the page.
export function decompress(body, enc, { truncated = false, limit = MAX_BYTES } = {}) {
  const factory = enc.includes("gzip") ? createGunzip : enc.includes("deflate") ? createInflate : enc.includes("br") ? createBrotliDecompress : null;
  if (!factory || !body.length) return Promise.resolve(body); // an empty body is an empty page
  return new Promise((resolve, reject) => {
    const dec = factory();
    const chunks = [];
    let size = 0, done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    dec.on("data", (c) => {
      chunks.push(c);
      size += c.length;
      if (size >= limit) { finish(Buffer.concat(chunks).subarray(0, limit)); dec.destroy(); }
    });
    dec.on("end", () => finish(Buffer.concat(chunks).subarray(0, limit)));
    dec.on("error", (e) => (truncated ? finish(Buffer.concat(chunks).subarray(0, limit)) : fail(new Error(`body is not valid ${enc} (${e.message}); the server mislabels its encoding`))));
    dec.end(body);
  });
}

function validatingLookup(hostname, opts, cb) {
  lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const pub = addrs.filter((a) => !isPrivateIp(a.address));
    if (!pub.length) return cb(blocked(hostname));
    // Node >=24 resolves with all:true and expects an array of {address, family} back.
    if (opts?.all) cb(null, pub.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, pub[0].address, pub[0].family);
  });
}

// The request is destroyed at the policy's deadline, a hard one, not a socket idle timeout, so a
// server that drips bytes cannot hold the caller. The deadline spans decompression too: the edge's
// fetch decodes as it reads, so one budget means the same on both transports. `inflate` is
// decompress; verify alone replaces it, to hold it past the deadline. No agent: a pooled socket the
// server closes unannounced after a redirect resets the next hop, and one request per hop needs no pool.
export const nodeTransport = (resolver, inflate = decompress) => (url, { host, headers, deadline, budget, maxBytes }) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const isHttps = u.protocol === "https:";
  let timer;
  const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
  resolve = done(resolve); reject = done(reject);
  const r = (isHttps ? httpsRequest : httpRequest)({
    protocol: u.protocol,
    hostname: host,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: "GET",
    lookup: resolver,
    agent: false,
    headers,
  }, (res) => {
    res.on("error", reject); // mid-body abort must reject, not crash the process
    if (REDIRECT.has(res.statusCode) || res.statusCode >= 400) {
      // Destroyed, never drained: a drain outlives the deadline and holds the process open.
      resolve({ status: res.statusCode, location: res.headers.location });
      return res.destroy();
    }

    const chunks = [];
    let size = 0, read = false;
    // The body is read one byte past maxBytes (enough to show the page is longer) and the
    // connection then closed; decompression is capped the same way.
    const finish = async () => {
      if (read) return;
      read = true;
      let body;
      try { body = await inflate(Buffer.concat(chunks).subarray(0, maxBytes + 1), (res.headers["content-encoding"] || "").toLowerCase(), { truncated: size > maxBytes, limit: maxBytes + 1 }); }
      catch (e) { return reject(new Error(`${e.message}: ${url}`)); }
      resolve({ status: res.statusCode, body, over: size > maxBytes });
    };
    res.on("data", (c) => {
      chunks.push(c);
      size += c.length;
      if (size > maxBytes) { res.off("error", reject).on("error", () => {}); r.off("error", reject).on("error", () => {}); finish(); res.destroy(); }
    });
    res.on("end", finish);
  });
  // Rejected here, not only through destroy: a request whose response has ended emits no error.
  timer = setTimeout(() => { const e = noAnswer(url, budget); reject(e); r.destroy(e); }, deadline - Date.now());
  r.on("error", reject);
  r.end();
});

// opts.timeout: the total budget in ms (default 30 s). opts.lookup replaces the SSRF-validating
// resolver and exists for verify's local test servers only; nothing else may pass it.
export function fetchSnapshot(url, opts = {}) {
  return fetchPage(url, nodeTransport(opts.lookup ?? validatingLookup), { timeout: opts.timeout });
}
