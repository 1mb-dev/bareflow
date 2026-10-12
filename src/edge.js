// The web's fetch: the /_fetch Pages Function (functions/_fetch.js) as a handler over an injected
// fetch, so verify runs it under Node. It fetches and returns the capped bytes; it does not decode,
// hash, or convert (the browser does, CPU here stays under the free plan's 10 ms). Workers fetch
// cannot pin DNS: a name that resolves to a private address is refused by Cloudflare's network,
// not here. Literals, ports, userinfo, and our own zones are refused here on every hop.
import { checkTarget, fetchBody, MAX_BYTES, noAnswer, REDIRECT } from "./fetch-policy.js";

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const OWN_ZONES = ["1mb.dev", "pages.dev"];
// The web's byte cap, below the CLI's: every byte read costs Function CPU (Free: 10 ms per
// request), so it is set by measurement on a preview deploy. Docs pages are far smaller
// (fixtures: max 541 KB).
export const WEB_MAX_BYTES = 1024 * 1024;
// Cloudflare's published test secrets, refused off loopback: 1x passes every token.
export const TEST_SECRETS = new Set(["1", "2", "3"].map((n) => `${n}x0000000000000000000000000000000AA`));
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The policy's checkTarget (scheme, private literals), then the Function's own guards.
export function edgeCheck(url) {
  const u = new URL(url);
  const target = checkTarget(url);
  // "1mb.dev." is 1mb.dev: a trailing dot is the same name in DNS.
  const host = target.host.replace(/\.+$/, "");
  if (u.username || u.password) throw refused(`credentials in ${url}: the web fetches no URL with a user or password`);
  if (u.port && u.port !== "80" && u.port !== "443") throw refused(`port ${u.port} in ${url}: the web fetches ports 80 and 443 only; run npx bareflow for others`);
  if (target.literal) throw refused(`IP address ${host}: the web fetches host names only; run npx bareflow for an address`);
  if (OWN_ZONES.some((z) => host === z || host.endsWith(`.${z}`))) throw refused(`${host} is not fetched by the web`);
  // Cloudflare's network refuses these; a local dev server would not.
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) throw refused(`${host} is not a public host name`);
}
const refused = (message) => Object.assign(new Error(message), { code: "url" });

// Read a body stream one byte past max, then cancel it: a bomb or an endless body costs at most
// the cap. fetch has already removed the content encoding.
async function readCapped(stream, max) {
  const chunks = [];
  let size = 0;
  if (stream) {
    const reader = stream.getReader();
    while (size <= max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    if (size > max) reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(size, max + 1));
  let at = 0;
  for (const c of chunks) { if (at >= out.length) break; out.set(c.subarray(0, out.length - at), at); at += c.length; }
  return out;
}

// The policy's transport over WHATWG fetch: one request, no redirect followed, aborted at the
// policy's deadline whether headers or body are late.
// Workers decompress in the Function's CPU time (10 ms on Free), so it asks for identity; a site
// that compresses anyway is still decoded, and still capped.
export const edgeTransport = (fetchImpl) => async (url, { headers, deadline, budget, maxBytes }) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, deadline - Date.now()));
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { ...headers, "accept-encoding": "identity" }, redirect: "manual", signal: ctl.signal });
    if (REDIRECT.has(res.status) || res.status >= 400) {
      res.body?.cancel().catch(() => {});
      return { status: res.status, location: res.headers.get("location") ?? undefined };
    }
    // A declared length over the cap is refused unread; an understated one is caught by the read.
    if (Number(res.headers.get("content-length")) > maxBytes) {
      res.body?.cancel().catch(() => {});
      return { status: res.status, over: true };
    }
    try { return { status: res.status, body: await readCapped(res.body, maxBytes) }; }
    catch (e) {
      if (ctl.signal.aborted) throw e;
      const enc = res.headers.get("content-encoding");
      throw new Error(enc ? `body is not valid ${enc} (${e.message}); the server mislabels its encoding: ${url}` : `body could not be read (${e.message}): ${url}`);
    }
  } catch (e) {
    if (ctl.signal.aborted) throw noAnswer(url, budget);
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// Every response is inert where it lands: no sniffing, no rendering, no script.
const INERT = { "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "no-store" };
const fail = (status, code, message) => new Response(message, { status, headers: { ...INERT, "content-type": "text/plain; charset=utf-8", "x-bareflow-error": code } });

// The code the app maps to a named error: token, unavailable, url, blocked, timeout, upstream,
// over-cap.
function failure(e) {
  const m = String(e?.message || e);
  if (e?.code === "url" || m.startsWith("not a URL") || m.startsWith("unsupported protocol")) return fail(400, "url", m);
  if (m.startsWith("blocked address")) return fail(403, "blocked", m);
  if (m.startsWith("no answer")) return fail(504, "timeout", m);
  return fail(502, "upstream", m);
}

// "ok", "bad" (Turnstile said no), or "down" (siteverify did not answer usably: not the visitor's fault).
async function checkToken(fetchImpl, secret, token, ip) {
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }), signal: AbortSignal.timeout(10000) });
    if (!res.ok) return "down";
    return (await res.json())?.success === true ? "ok" : "bad";
  } catch { return "down"; }
}

// GET /_fetch?url=<target> with the Turnstile token in x-turnstile-token. The target and the
// visitor are never logged.
export const handler = (fetchImpl, { timeout = 30000 } = {}) => async ({ request, env }) => {
  if (request.method !== "GET") return fail(405, "url", "GET only");
  if (!env?.TURNSTILE_SECRET) return fail(503, "unavailable", "the fetch is not configured (no TURNSTILE_SECRET)");
  const req = new URL(request.url);
  if (TEST_SECRETS.has(env.TURNSTILE_SECRET.trim()) && !LOCAL.has(req.hostname)) return fail(503, "unavailable", "the fetch is not configured (a Turnstile test secret off localhost)");
  const token = request.headers.get("x-turnstile-token");
  if (!token) return fail(403, "token", "no Turnstile token; reload the page");
  const target = req.searchParams.get("url");
  if (!target) return fail(400, "url", "no url parameter");
  try { edgeCheck(target); } catch (e) { return failure(e); }
  const verdict = await checkToken(fetchImpl, env.TURNSTILE_SECRET, token, request.headers.get("cf-connecting-ip"));
  if (verdict === "down") return fail(503, "unavailable", "the bot check service did not answer; try again later");
  if (verdict === "bad") return fail(403, "token", "the Turnstile check failed or expired; reload the page");
  try {
    const { finalUrl, body, over } = await fetchBody(target, edgeTransport(fetchImpl), { timeout, check: edgeCheck, maxBytes: WEB_MAX_BYTES });
    if (over) return fail(502, "over-cap", `the page is over ${WEB_MAX_BYTES / 1048576} MB, the web's limit; npx bareflow reads up to ${MAX_BYTES / 1048576} MB`);
    return new Response(body, { status: 200, headers: { ...INERT, "content-type": "application/octet-stream", "content-disposition": "attachment", "x-final-url": finalUrl } });
  } catch (e) { return failure(e); }
};
