// What the platform counted for the /_fetch Function over the last days, read locally by the owner:
// invocations by status (GraphQL; exceededResources is the CPU trigger's field: 1102 and 1027, mostly
// CPU time, also startup and free-tier limits) and the outcome counter (Analytics Engine SQL).
//   CLOUDFLARE_ACCOUNT_ID=<id> CF_ANALYTICS_TOKEN=<token> node scripts/counts.js [--days <n>]
// The token is Account Analytics Read alone, with an expiry, kept off this repo and off CI.
// Exit 1: exceededResources > 0 in any Functions script on the account (the breakdown names which;
// reopen the read-path cap or W3 if it is bareflow's). 2: nothing to judge: more than one script (the
// read cannot tell bareflow's), no invocations, no outcomes, a failed read, or a usage error. 0:
// otherwise. The hourly probe's 403s are invocations and outcomes, so 0 proves the read sees the
// Function; the non-token count is what real conversions added.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
// Unverified until the first production read (S2): the dataset's name, and bareflow's scriptName (then a
// constant here).
const QUERY = `query ($account: String!, $since: Time!, $until: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $until }) {
      sum { requests } dimensions { scriptName status }
    }
  } }
}`;
const OUTCOMES = (days) => `SELECT blob1 AS outcome, blob2 AS class, SUM(_sample_interval) AS n FROM bareflow_outcomes WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY outcome, class ORDER BY n DESC FORMAT JSON`;

async function post(url, token, body, type) {
  const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type }, body, signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${url.replace(/accounts\/[^/]+/, "accounts/<id>")}: ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function counts({ account, token, days = 7 }) {
  const now = new Date(), until = now.toISOString(), since = new Date(now - days * 86400000).toISOString();
  const g = await post(`${API}/graphql`, token, JSON.stringify({ query: QUERY, variables: { account, since, until } }), "application/json");
  if (g.errors?.length) throw new Error(`GraphQL: ${g.errors.map((e) => e.message).join("; ")}`);
  const groups = g.data?.viewer?.accounts?.[0]?.pagesFunctionsInvocationsAdaptiveGroups ?? [];
  const byScript = {};
  for (const { dimensions: { scriptName, status }, sum } of groups) (byScript[scriptName] ??= {})[status] = (byScript[scriptName][status] ?? 0) + sum.requests;
  const a = await post(`${API}/accounts/${account}/analytics_engine/sql`, token, OUTCOMES(days), "text/plain");
  const outcomes = (a.data ?? []).map((r) => [r.outcome, r.class, Number(r.n)]);
  return { since, until, byScript, outcomes };
}

// 0, 1, or 2, as the header says.
export function verdict({ byScript, outcomes }) {
  const scripts = Object.values(byScript);
  if (scripts.some((s) => s.exceededResources > 0)) return 1;
  if (scripts.length !== 1) return 2;
  return Object.values(scripts[0]).some((n) => n > 0) && outcomes.length ? 0 : 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2), days = args[0] === "--days" ? Number(args[1]) : 7;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CF_ANALYTICS_TOKEN;
  if ((args.length && !(args.length === 2 && args[0] === "--days")) || !(Number.isInteger(days) && days > 0 && days <= 30)) { console.error("usage: node scripts/counts.js [--days <1-30>]"); process.exit(2); }
  if (!account || !token) { console.error("CLOUDFLARE_ACCOUNT_ID and CF_ANALYTICS_TOKEN (Account Analytics Read) must be set"); process.exit(2); }
  let c;
  try { c = await counts({ account, token, days }); } catch (e) { console.error(`read failed: ${e.message}`); process.exit(2); }
  console.log(`${c.since} .. ${c.until}`);
  for (const [script, byStatus] of Object.entries(c.byScript)) for (const [status, n] of Object.entries(byStatus).sort((x, y) => y[1] - x[1])) console.log(`invocations  ${script}  ${status}  ${n}`);
  for (const [outcome, cls, n] of c.outcomes) console.log(`outcomes     ${outcome} ${cls}  ${n}`);
  console.log(`outcomes other than token: ${c.outcomes.filter(([o]) => o !== "token").reduce((a, [, , n]) => a + n, 0)}`);
  const v = verdict(c);
  const over = Object.entries(c.byScript).filter(([, st]) => st.exceededResources > 0).map(([script]) => script);
  console.log([`ok: invocations seen, none exceededResources`, `exceededResources > 0 in ${over.join(", ")}: if that is bareflow's, reopen the read-path cap or W3`,
    Object.keys(c.byScript).length > 1 ? `nothing to judge: ${Object.keys(c.byScript).length} Functions scripts (${Object.keys(c.byScript).join(", ")}); pin bareflow's name in this script` : "nothing to judge: no invocations or no outcomes counted"][v]);
  process.exit(v);
}
