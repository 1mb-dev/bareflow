// The web app: `npm run site` writes dist/site/, the Pages output directory (functions/ is beside
// it at the repo root). The worker is the verified bundle (scripts/bundle.js) plus site/worker.js.
// TURNSTILE_SITEKEY sets the widget's key; unset, it is Cloudflare's always-pass test key.
// Pages serves index.html for every path that is not a file, so it is the shell of every share
// URL; the home is _app/home.html, served at / by _redirects. The icons are drawn from tokens.css
// here (scripts/icon.js).
import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.js";
import { exampleHtml } from "./example.js";
import { iconIco, iconPng, iconSvg, palette } from "./icon.js";
import { VERSION } from "../src/version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_SITEKEY = "1x00000000000000000000AA";
// Where the home's example goes in the template; the shell gets nothing there. A function, not a
// string: a replacement string reads $&, $', and $` in third-party text as patterns.
export const MARK = "<!-- example -->\n";
export const splice = (html, chunk) => html.replace(MARK, () => chunk);

export async function site(out = join(ROOT, "dist/site"), sitekey = process.env.TURNSTILE_SITEKEY || TEST_SITEKEY) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "_app"), { recursive: true });
  const app = await build({ entryPoints: [join(ROOT, "site/app.js")], bundle: true, format: "esm", platform: "browser", minify: true, write: false, logLevel: "silent" });
  const tokens = await readFile(join(ROOT, "site/tokens.css"), "utf8"), { light, dark } = palette(tokens);
  const html = (await readFile(join(ROOT, "site/index.html"), "utf8")).replace("__SITEKEY__", () => sitekey).replace("__VERSION__", () => VERSION)
    .replace("__PAPER__", () => light.paper).replace("__PAPER_DARK__", () => dark.paper);
  if (html.split(MARK).length !== 2) throw new Error(`site/index.html: needs ${JSON.stringify(MARK)} exactly once`);
  await Promise.all([
    writeFile(join(out, "index.html"), splice(html, "")),
    writeFile(join(out, "_app/home.html"), splice(html, `${await exampleHtml()}\n`)),
    writeFile(join(out, "_app/app.js"), app.outputFiles[0].text),
    copyFile(join(ROOT, "site/theme.js"), join(out, "_app/theme.js")),
    writeFile(join(out, "_app/icon.svg"), iconSvg(tokens)),
    writeFile(join(out, "_app/touch.png"), iconPng(tokens, 180, 9)),
    writeFile(join(out, "favicon.ico"), iconIco(tokens)),
    writeFile(join(out, "_app/worker.js"), `${await bundle()}\n${await readFile(join(ROOT, "site/worker.js"), "utf8")}`),
    writeFile(join(out, "_app/style.css"), (await Promise.all(["site/tokens.css", "site/style.css"].map((f) => readFile(join(ROOT, f), "utf8")))).join("\n")),
    cp(join(ROOT, "site/fonts"), join(out, "_app/fonts"), { recursive: true }),
    copyFile(join(ROOT, "site/_headers"), join(out, "_headers")),
    copyFile(join(ROOT, "site/_routes.json"), join(out, "_routes.json")),
    copyFile(join(ROOT, "site/_redirects"), join(out, "_redirects")),
  ]);
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.env.TURNSTILE_SITEKEY) console.error(`TURNSTILE_SITEKEY unset: built with Cloudflare's always-pass test key ${TEST_SITEKEY}; local use only, a deploy needs the real key`);
  console.log(await site());
}
