// One fetch policy over an injected transport: what may be fetched, how redirects are followed,
// the time and byte budgets, the request headers, and the error text. No node: imports, so the
// CLI (fetch.js, node:http with a pinned resolver) and the edge Function share it. A transport
// makes one request and never follows a redirect itself; every hop comes back here.
import { sha256 } from "./sha256.js";
import { isPrivateIp } from "./ssrf.js";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_HOPS = 5;
export const TIMEOUT = 30000; // ms for the whole fetch, redirects included
export const CONVERT_TIMEOUT = 20000; // ms for one conversion, CLI (src/bounded.js) and web (site/app.js)
export const REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "accept": "text/html",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
};
export const REDIRECT = new Set([301, 302, 303, 307, 308]);

export const noAnswer = (url, budget) => Object.assign(new Error(`no answer from ${url} within ${budget} ms (redirects included); retry, or open it in a browser`), { url });
export const blocked = (host) => new Error(`blocked address for ${host}: bareflow fetches public addresses only`);

// The one URL check: parsed, and http(s). Both the fetch and a pasted page's asserted URL go
// through it.
export function httpUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`not a URL: ${url}; give a full http(s) URL`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`unsupported protocol ${u.protocol} in ${url}; give an http(s) URL`);
  return u;
}

// URL keeps an IPv6 literal's brackets ("[::1]") and normalizes every IPv4 spelling (0x7f.1,
// 2130706433) to dotted form, so a literal is a dotted quad or contains ":". A name is never
// matched against the ranges: "10.example.com" is a name.
export function checkTarget(url) {
  const host = httpUrl(url).hostname.replace(/^\[|\]$/g, "");
  const literal = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  if (literal && isPrivateIp(host)) throw blocked(host);
  return { host, literal };
}

// transport(url, { host, headers, deadline, budget, maxBytes }) resolves one response: { status,
// location, body, over } where body is the decoded bytes (Uint8Array), read past maxBytes only far
// enough to show the page is longer, or over: true when it refused a declared length unread; body
// is absent on a redirect, and a response without one (204, 304) is an empty page. It rejects
// with noAnswer at the deadline. check(url) runs on every hop after checkTarget: the edge
// Function's own guards. over: the page did not fit maxBytes; body is at most its first maxBytes.
// A transport may instead resolve { status, stream, length }: a body handed on unread through a
// stream that enforces length bytes (the edge Function's response; fetchPage needs bytes).
export async function fetchBody(url, transport, { timeout = TIMEOUT, check, maxBytes = MAX_BYTES } = {}) {
  const deadline = Date.now() + timeout;
  // Serialized as the parser does, so finalUrl has one form with or without a redirect.
  let at = httpUrl(url).href;
  for (let hop = 0; ; hop++) {
    if (hop > MAX_HOPS) throw new Error(`more than ${MAX_HOPS} redirects from ${at}`);
    const { host } = checkTarget(at);
    check?.(at);
    if (deadline - Date.now() <= 0) throw noAnswer(at, timeout);
    const res = await transport(at, { host, headers: REQUEST_HEADERS, deadline, budget: timeout, maxBytes });
    if (REDIRECT.has(res.status)) {
      if (!res.location) throw new Error(`redirect ${res.status} without a location from ${at}`);
      try { at = new URL(res.location, at).toString(); } catch { throw new Error(`redirect ${res.status} from ${at} to an invalid location`); }
      continue;
    }
    if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status} from ${at}; check the URL (bareflow does not retry)`), { status: res.status, url: at });
    if (res.stream) {
      if (!(res.length <= maxBytes)) {
        res.stream.cancel().catch(() => {});
        throw new Error(`a transport handed on ${res.length} bytes, past the ${maxBytes}-byte cap`);
      }
      return { finalUrl: at, stream: res.stream, over: false };
    }
    const body = res.body ?? new Uint8Array();
    return { finalUrl: at, body: body.subarray(0, maxBytes), over: !!res.over || body.length > maxBytes };
  }
}

// The fetched bytes as a page: the CLI makes it after fetchBody, the browser after /_fetch.
export function snapshot({ finalUrl, body }) {
  return {
    finalUrl,
    bytes: body.length,
    // ignoreBOM keeps a leading BOM in the text, as the page has it.
    html: new TextDecoder("utf-8", { ignoreBOM: true }).decode(body),
    fingerprint: sha256(body).slice(0, 16),
    retrievedAt: new Date().toISOString(),
  };
}

export async function fetchPage(url, transport, opts) {
  const got = await fetchBody(url, transport, opts);
  if (got.stream) {
    got.stream.cancel().catch(() => {});
    throw new Error("fetchPage needs bytes: this transport hands bodies on as streams");
  }
  return snapshot(got);
}
