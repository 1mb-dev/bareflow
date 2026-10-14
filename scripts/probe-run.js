// The probe as the Function runs it: Worker-safe (scripts/probe.js assembles the deployment). A fixed
// list, no input: the probe never fetches an address it is given.
import { edgeCheck, edgeTransport } from "../src/edge.js";
import { fetchBody } from "../src/fetch-policy.js";

export const PROBES = [
  ["loopback by name", "http://localtest.me/"],
  ["10/8", "http://10.0.0.1.nip.io/"],
  ["cloud metadata", "http://169.254.169.254.nip.io/"],
  ["127/8", "http://127.0.0.1.sslip.io/"],
  ["0.0.0.0", "http://0.0.0.0.nip.io/"],
  ["shared 100.64/10", "http://100.64.0.1.nip.io/"],
  ["::1", "http://--1.sslip.io/"],
  ["IPv4-mapped ::ffff:127.0.0.1", "http://--ffff-7f00-1.sslip.io/"],
  ["NAT64 64:ff9b::127.0.0.1", "http://64-ff9b--7f00-1.sslip.io/"],
  ["unique local fd00::1", "http://fd00--1.sslip.io/"],
  ["link local fe80::1", "http://fe80--1.sslip.io/"],
  ["a redirect to loopback", "https://httpbin.org/redirect-to?url=http%3A%2F%2Flocaltest.me%2F"],
  ["a Cloudflare edge address", "http://104.21.22.231.nip.io/"],
].map(([name, url]) => ({ name, url }));
export const CONTROL = { name: "control", url: "https://example.com/" };
// Cloudflare's codes for a private answer, as measured (1016 origin DNS error, 1002 prohibited IP).
// Any other code is a zone's own rule (1020 WAF, 1015 rate limit), not a refusal of the address.
const REFUSED = new Set(["1016", "1002"]);
const HEAD = 4096;

// pass: Cloudflare refused the address by name; finding: anything else that spoke HTTP (a status
// means a connection was made); inconclusive: a throw (a timeout or a reset says nothing), or another
// Cloudflare code.
export function classify(o) {
  if (o.status === undefined) return "inconclusive";
  if (o.status >= 400 && o.code) return REFUSED.has(o.code) ? "pass" : "inconclusive";
  return "finding";
}

// The first HEAD bytes of a body, then cancel: a target that streams forever costs one read.
async function head(body) {
  if (!body) return "";
  const reader = body.getReader(), decoder = new TextDecoder();
  let text = "", n = 0;
  try {
    while (n < HEAD) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.cancel().catch(() => {}); }
  return text;
}

// The status is kept before the body is read: a body that fails after it does not unsay the answer.
async function raw(fetchImpl, url, timeout) {
  const t0 = Date.now();
  let r;
  try { r = await fetchImpl(url, { signal: AbortSignal.timeout(timeout) }); } catch (e) { return { threw: String(e?.message ?? e), ms: Date.now() - t0 }; }
  const o = { status: r.status, code: null, ms: 0 };
  try {
    const text = await head(r.body);
    o.code = text.match(/error code: (\d+)/)?.[1] ?? null;
    o.start = text.slice(0, 80);
  } catch (e) { o.bodyError = String(e?.message ?? e); }
  o.ms = Date.now() - t0;
  return o;
}

// Each name twice: raw Workers fetch (what Cloudflare does) and the policy (what /_fetch would answer).
async function one(fetchImpl, { name, url }, timeout) {
  const [o, policy] = await Promise.all([raw(fetchImpl, url, timeout),
    fetchBody(url, edgeTransport(fetchImpl), { timeout, check: edgeCheck, maxBytes: HEAD }).then((r) => `fetched ${r.finalUrl}`, (e) => String(e.message))]);
  return { name, url, ...o, policy };
}

// WIDTH names at a time, two connections each: a Worker holds six open, and a fetch queued behind
// them would spend its timeout waiting. Each timer starts when its request is sent.
const WIDTH = 3;
export async function probe(fetchImpl, { timeout = 8000 } = {}) {
  const all = [...PROBES, CONTROL], rows = [];
  let next = 0;
  const lane = async () => { while (next < all.length) { const i = next++; rows[i] = await one(fetchImpl, all[i], timeout); } };
  await Promise.all(Array.from({ length: WIDTH }, lane));
  // A control that does not fetch means the egress itself failed: no row measured anything.
  const ok = rows.at(-1).status === 200;
  return rows.map((r) => ({ ...r, verdict: !ok ? "void: the control did not fetch" : r.name === CONTROL.name ? "control ok" : classify(r) }));
}
