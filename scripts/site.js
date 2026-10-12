// The web app: `npm run site` writes dist/site/, the Pages output directory (functions/ is beside
// it at the repo root). The worker is the verified bundle (scripts/bundle.js) plus site/worker.js.
// TURNSTILE_SITEKEY sets the widget's key; unset, it is Cloudflare's always-pass test key.
import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_SITEKEY = "1x00000000000000000000AA";

export async function site(out = join(ROOT, "dist/site"), sitekey = process.env.TURNSTILE_SITEKEY || TEST_SITEKEY) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "_app"), { recursive: true });
  const app = await build({ entryPoints: [join(ROOT, "site/app.js")], bundle: true, format: "esm", platform: "browser", minify: true, write: false, logLevel: "silent" });
  const html = (await readFile(join(ROOT, "site/index.html"), "utf8")).replace("__SITEKEY__", sitekey);
  await Promise.all([
    writeFile(join(out, "index.html"), html),
    writeFile(join(out, "_app/app.js"), app.outputFiles[0].text),
    writeFile(join(out, "_app/worker.js"), `${await bundle()}\n${await readFile(join(ROOT, "site/worker.js"), "utf8")}`),
    writeFile(join(out, "_app/style.css"), (await Promise.all(["site/tokens.css", "site/style.css"].map((f) => readFile(join(ROOT, f), "utf8")))).join("\n")),
    cp(join(ROOT, "site/fonts"), join(out, "_app/fonts"), { recursive: true }),
    copyFile(join(ROOT, "site/_headers"), join(out, "_headers")),
    copyFile(join(ROOT, "site/_routes.json"), join(out, "_routes.json")),
  ]);
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.env.TURNSTILE_SITEKEY) console.error(`TURNSTILE_SITEKEY unset: built with Cloudflare's always-pass test key ${TEST_SITEKEY}; local use only, a deploy needs the real key`);
  console.log(await site());
}
