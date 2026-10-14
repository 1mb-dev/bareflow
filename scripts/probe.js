// Where the web's fetch goes when a public name resolves to a private address: Workers fetch cannot pin
// DNS, so only a deployed Function on Cloudflare's network can say (scripts/probe-run.js: the list).
//   node scripts/probe.js <dir>      writes a deployable copy of the project with /_probe as its one route
//   cd <dir> && wrangler pages deploy --branch probe --commit-dirty=true
// The deployment is a preview (behind Access): open its /_probe signed in, read the rows (also in
// `wrangler pages deployment tail`), then delete the deployment.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTION = `import { probe } from "../scripts/probe-run.js";
export const onRequestGet = async () => {
  const rows = await probe((url, init) => fetch(url, init));
  for (const r of rows) console.log(JSON.stringify(r));
  return Response.json(rows, { headers: { "cache-control": "no-store" } });
};
`;

async function assemble(out) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  await mkdir(join(out, "functions"), { recursive: true });
  await mkdir(join(out, "scripts"), { recursive: true });
  await cp(join(ROOT, "wrangler.toml"), join(out, "wrangler.toml"));
  await cp(join(ROOT, "dist/site"), join(out, "dist/site"), { recursive: true });
  await writeFile(join(out, "dist/site/_routes.json"), `${JSON.stringify({ version: 1, include: ["/_probe"], exclude: [] })}\n`);
  await cp(join(ROOT, "src"), join(out, "src"), { recursive: true });
  await cp(join(ROOT, "scripts/probe-run.js"), join(out, "scripts/probe-run.js"));
  await writeFile(join(out, "functions/_probe.js"), FUNCTION);
  console.log(`${out}: deploy with \`cd ${out} && wrangler pages deploy --branch probe --commit-dirty=true\``);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) throw new Error("usage: node scripts/probe.js <dir> (an empty directory for the deployable copy)");
  await assemble(process.argv[2]);
}
