// The web's fetch: the /_fetch Pages Function (functions/_fetch.js) as a handler over an injected
// fetch, so verify runs it under Node. It fetches and returns the capped bytes; it does not decode,
// hash, or convert (the browser does, CPU here stays under the free plan's 10 ms). Workers fetch
// cannot pin DNS: a name that resolves to a private address is refused by Cloudflare's network,
// not here. Literals, ports, userinfo, and our own zones are refused here on every hop.
import { checkTarget, fetchBody, MAX_BYTES, noAnswer, REDIRECT } from "./fetch-policy.js";

export const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const OWN_ZONES = ["1mb.dev", "pages.dev"];

// The Function's guards on top of the policy's checkTarget (scheme, private literals).
export function edgeCheck(url) {
  const u = new URL(url);
  // "1mb.dev." is 1mb.dev: a trailing dot is the same name in DNS.
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (u.username || u.password) throw refused(`credentials in ${url}: the web fetches no URL with a user or password`);
  if (u.port && u.port !== "80" && u.port !== "443") throw refused(`port ${u.port} in ${url}: the web fetches ports 80 and 443 only; run npx bareflow for others`);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) throw refused(`IP address ${host}: the web fetches host names only; run npx bareflow for an address`);
  if (OWN_ZONES.some((z) => host === z || host.endsWith(`.${z}`))) throw refused(`${host} is not fetched by the web`);
  // Cloudflare's network refuses these; a local dev server would not.
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost")) throw refused(`${host} is not a public host name`);
}
const refused = (message) => Object.assign(new Error(message), { code: "url" });

// Read a body stream to MAX_BYTES, then cancel it: a bomb or an endless body costs at most the
// cap. fetch has already removed the content encoding.
async function readCapped(stream) {
  const chunks = [];
  let size = 0;
  if (stream) {
    const reader = stream.getReader();
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    if (size >= MAX_BYTES) reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(size, MAX_BYTES));
  let at = 0;
  for (const c of chunks) { if (at >= out.length) break; out.set(c.subarray(0, out.length - at), at); at += c.length; }
  return out;
}

// The policy's transport over WHATWG fetch: one request, no redirect followed, aborted at the
// policy's deadline whether headers or body are late.
export const edgeTransport = (fetchImpl) => async (url, { headers, deadline, budget }) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, deadline - Date.now()));
  try {
    const res = await fetchImpl(url, { method: "GET", headers, redirect: "manual", signal: ctl.signal });
    if (REDIRECT.has(res.status) || res.status >= 400) {
      res.body?.cancel().catch(() => {});
      return { status: res.status, location: res.headers.get("location") ?? undefined };
    }
    try { return { status: res.status, body: await readCapped(res.body) }; }
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

// The code the app maps to a named error: token, url, blocked, timeout, upstream.
function failure(e) {
  const m = String(e?.message || e);
  if (e?.code === "url" || m.startsWith("not a URL") || m.startsWith("unsupported protocol")) return fail(400, "url", m);
  if (m.startsWith("blocked address")) return fail(403, "blocked", m);
  if (m.startsWith("no answer")) return fail(504, "timeout", m);
  return fail(502, "upstream", m);
}

async function tokenOk(fetchImpl, secret, token, ip) {
  try {
    const res = await fetchImpl(SITEVERIFY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }) });
    return (await res.json())?.success === true;
  } catch { return false; }
}

// GET /_fetch?url=<target> with the Turnstile token in x-turnstile-token. The target and the
// visitor are never logged.
export const handler = (fetchImpl, { timeout = 30000 } = {}) => async ({ request, env }) => {
  if (request.method !== "GET") return fail(405, "url", "GET only");
  const token = request.headers.get("x-turnstile-token");
  if (!token || !env?.TURNSTILE_SECRET) return fail(403, "token", "no Turnstile token; reload the page");
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return fail(400, "url", "no url parameter");
  try { checkTarget(target); edgeCheck(target); } catch (e) { return failure(e); }
  if (!(await tokenOk(fetchImpl, env.TURNSTILE_SECRET, token, request.headers.get("cf-connecting-ip")))) return fail(403, "token", "the Turnstile check failed or expired; reload the page");
  try {
    const { finalUrl, body } = await fetchBody(target, edgeTransport(fetchImpl), { timeout, check: edgeCheck });
    return new Response(body, { status: 200, headers: { ...INERT, "content-type": "application/octet-stream", "content-disposition": "attachment", "x-final-url": finalUrl } });
  } catch (e) { return failure(e); }
};
