// Where the web's fetch goes when a public name resolves to a private address: Workers fetch cannot pin
// DNS, so only a deployed Function on Cloudflare's network can say (scripts/probe-run.js: the list).
//   node scripts/probe.js <dir>            a deployable copy of the project with /_probe as its one route
//   cd <dir> && wrangler pages deploy --branch probe --commit-dirty=true
//   node scripts/probe.js --check <host>   before any probe: Access answers /_probe, else delete unprobed
// Then open /_probe signed in, read the rows (also in `wrangler pages deployment tail`), and delete the
// deployment (an aliased one needs the dashboard: wrangler's --force does not force it).
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTION = `import { probe } from "../scripts/probe-run.js";
export const onRequestGet = async () => {
  const rows = await probe((url, init) => fetch(url, init));
  for (const r of rows) console.log(JSON.stringify(r));
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
};
`;

// Never into the repo: its functions/ and dist/site/_routes.json would ship /_probe with the next deploy.
export async function assemble(dir) {
  const out = resolve(dir), inside = relative(ROOT, out);
  if (!inside || !(inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))) throw new Error(`${out} is inside the repository: give an empty directory outside it`);
  if (existsSync(out) && (await readdir(out)).length) throw new Error(`${out} is not empty: give an empty directory`);
  if (!existsSync(join(ROOT, "dist/site/index.html"))) throw new Error("dist/site is not built: run `npm run site` first");
  await mkdir(join(out, "functions"), { recursive: true });
  await mkdir(join(out, "scripts"), { recursive: true });
  await cp(join(ROOT, "wrangler.toml"), join(out, "wrangler.toml"));
  await cp(join(ROOT, "dist/site"), join(out, "dist/site"), { recursive: true });
  await writeFile(join(out, "dist/site/_routes.json"), `${JSON.stringify({ version: 1, include: ["/_probe"], exclude: [] })}\n`);
  await cp(join(ROOT, "src"), join(out, "src"), { recursive: true });
  await cp(join(ROOT, "scripts/probe-run.js"), join(out, "scripts/probe-run.js"));
  await writeFile(join(out, "functions/_probe.js"), FUNCTION);
  return out;
}

// /_probe has no gate of its own: unauthenticated, it must get Access's redirect, never the Function.
async function check(host) {
  const r = await fetch(`https://${host}/_probe`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  const to = r.headers.get("location") ? new URL(r.headers.get("location"), `https://${host}/`).hostname : "";
  if (r.status === 302 && to.endsWith(".cloudflareaccess.com")) return console.log(`ok    ${host}/_probe is behind Access (${to})`);
  console.log(`FAIL  ${host}/_probe answered ${r.status} ${to}: not behind Access; delete the deployment, do not probe`);
  process.exit(1);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [a, b] = process.argv.slice(2);
  if (a === "--check" && b) await check(b);
  else if (a && !a.startsWith("--") && !b) console.log(`${await assemble(a)}: deploy with \`cd <that dir> && wrangler pages deploy --branch probe --commit-dirty=true\``);
  else throw new Error("usage: node scripts/probe.js <empty dir outside the repo> | --check <host>");
}
