// The artifact a deploy ships, checked in the job that holds the token, before wrangler: dist/site was
// built in a job that ran every dependency. At the top level only what site.js writes, each of its
// kind; Pages' configuration byte for byte the checkout's site/ copies. A _worker.js (file or
// directory) would replace functions/ (Pages advanced mode); an edited _routes.json or _headers would
// reroute the Function or unpin the CSP. What the check leaves open is client code under that CSP.
//   node scripts/artifact.js <dir>
import { lstat, readdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Each top-level entry scripts/site.js writes, and whether it is a directory.
export const TOP = { _app: true, _headers: false, _redirects: false, "_routes.json": false, "favicon.ico": false, "index.html": false, "privacy.html": false, "robots.txt": false };
export const CONFIG = ["_headers", "_redirects", "_routes.json"];

export async function artifactFaults(dir, root = ROOT) {
  const out = [], seen = await readdir(dir);
  for (const name of seen) {
    if (!Object.hasOwn(TOP, name)) { out.push(`${name}: not an entry site.js writes`); continue; }
    const s = await lstat(join(dir, name));
    if (s.isSymbolicLink() || s.isDirectory() !== TOP[name] || !(s.isDirectory() || s.isFile())) out.push(`${name}: not a plain ${TOP[name] ? "directory" : "file"}`);
  }
  for (const name of Object.keys(TOP)) if (!seen.includes(name)) out.push(`${name}: missing`);
  for (const name of CONFIG) {
    if (!seen.includes(name)) continue;
    const [got, want] = await Promise.all([readFile(join(dir, name)).catch(() => null), readFile(join(root, "site", name))]);
    if (!got?.equals(want)) out.push(`${name}: differs from site/${name}`);
  }
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length !== 1) { console.error("usage: node scripts/artifact.js <dir>"); process.exit(2); }
  const found = await artifactFaults(args[0]).catch((e) => [`${e.path ?? args[0]}: ${e.code ?? e.message}`]);
  for (const f of found) console.error(`refused: ${f}`);
  if (found.length) process.exit(1);
  console.log(`${args[0]}: the entries site.js writes, Pages configuration equal to site/`);
}
