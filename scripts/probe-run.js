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

// pass: Cloudflare refused (the fetch threw at once, or a status >= 400 with its "error code: N");
// finding: any response reached the code; inconclusive: a timeout, a dropped connection, or an
// unnamed error status, which says nothing about whether Cloudflare connected.
export function classify(o) {
  if (o.threw) return /time(d)? ?out|abort|reset|lost|ECONN|closed/i.test(o.threw) ? "inconclusive" : "pass";
  if (o.status >= 400) return o.code ? "pass" : "inconclusive";
  return "finding";
}

async function raw(fetchImpl, url) {
  const t0 = Date.now();
  try {
    // Followed: a redirect is a hop the policy also takes.
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    const text = (await r.text()).slice(0, 300);
    return { status: r.status, code: text.match(/error code: (\d+)/)?.[1] ?? null, start: text.slice(0, 80), ms: Date.now() - t0 };
  } catch (e) {
    return { threw: String(e?.message ?? e), ms: Date.now() - t0 };
  }
}

// Each name twice: raw Workers fetch (what Cloudflare does) and the policy (what /_fetch would answer).
export async function probe(fetchImpl) {
  return Promise.all([...PROBES, CONTROL].map(async ({ name, url }) => {
    const [o, policy] = await Promise.all([raw(fetchImpl, url),
      fetchBody(url, edgeTransport(fetchImpl), { timeout: 8000, check: edgeCheck, maxBytes: 4096 }).then((r) => `fetched ${r.finalUrl}`, (e) => String(e.message))]);
    return { name, url, verdict: name === "control" ? (o.status === 200 ? "control ok" : "void: the control did not fetch") : classify(o), ...o, policy };
  }));
}
