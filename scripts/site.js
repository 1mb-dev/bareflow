// The web app: `npm run site` writes dist/site/, the Pages output directory (functions/ is beside
// it at the repo root). The worker is the verified bundle (scripts/bundle.js) plus site/worker.js.
// TURNSTILE_SITEKEY sets the widget's key; unset, it is Cloudflare's always-pass test key.
// Pages serves index.html for every path that is not a file, so it is the shell of every share
// URL; the home is _app/home.html, served at / by _redirects. The icons are drawn from tokens.css
// here (scripts/icon.js); the OG card is committed (scripts/card.js needs Chrome) and goes in the
// home's head only: an unfurler runs no script, so the shell's tags speak for every share URL.
// privacy.html (served at /privacy) is the shell's head and footer around site/privacy.html.
// The shell is noindex by its own meta, so every share URL is, whatever host serves it; the home and
// the privacy page cut it and name their canonical URL.
import { build } from "esbuild";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "./bundle.js";
import { excerpt, exampleHtml } from "./example.js";
import { stylesheet } from "./stylesheet.js";
import { iconIco, iconPng, iconSvg, palette } from "./icon.js";
import { CARD, cardAlt, cardWords } from "./card.js";
import { VERSION } from "../src/version.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TEST_SITEKEY = "1x00000000000000000000AA";
// Where the home's example goes in the template; the shell gets nothing there. A function, not a
// string: a replacement string reads $&, $', and $` in third-party text as patterns.
export const MARK = "<!-- example -->\n";
export const splice = (html, chunk, mark = MARK) => html.replace(mark, () => chunk);
export const CARD_MARK = "<!-- card -->\n";
export const NOINDEX = '<meta name="robots" content="noindex">\n';
const HOME_URL = "https://bareflow.1mb.dev/";
const PRIVACY_URL = "https://bareflow.1mb.dev/privacy";
export const homeTags = `<link rel="canonical" href="${HOME_URL}">
<meta property="og:url" content="${HOME_URL}">
`;
const cut = (s, part, where) => { if (s.split(part).length !== 2) throw new Error(`${where}: needs ${JSON.stringify(part)} exactly once`); return s.replace(part, ""); };
const attr = (t) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const cardTags = (alt) => `<meta property="og:image" content="${CARD.url}">
<meta property="og:image:width" content="${CARD.width}">
<meta property="og:image:height" content="${CARD.height}">
<meta property="og:image:alt" content="${attr(alt)}">
<meta name="twitter:card" content="summary_large_image">
`;

// The privacy page: the shell's head and footer, so the footer is the same bytes in every document,
// around its own main. Out of the head: app.js (so no Turnstile), the OG tags (the shell's speak
// for the site), and the serif preload (every word on the page is bareflow's, in Mono).
export function privacyPage(shell, main) {
  if (shell.split("<body").length !== 2) throw new Error("privacy page: the shell needs one <body");
  let head = shell.slice(0, shell.indexOf("<body"));
  for (const line of head.match(/^\s*<meta\b[^>]*\bproperty="og:[^>]*>\n/gm) ?? []) head = cut(head, line, "privacy page");
  for (const part of [NOINDEX, '<script type="module" src="/_app/app.js"></script>\n', '<link rel="preload" href="/_app/fonts/literata-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>\n']) head = cut(head, part, "privacy page");
  const swap = (s, re, to) => { if ((s.match(new RegExp(re, "g")) ?? []).length !== 1) throw new Error(`privacy page: the shell needs ${re} exactly once`); return s.replace(re, () => to); };
  head = swap(head, /<title>[^<]*<\/title>/, "<title>bareflow: privacy</title>");
  head = swap(head, /<meta name="description" content="[^"]*">/, `<meta name="description" content="What bareflow and Cloudflare see when you convert a page.">\n<link rel="canonical" href="${PRIVACY_URL}">`);
  const foot = shell.match(/^<footer class="foot">.*<\/footer>\n/m)?.[0];
  if (!foot) throw new Error("privacy page: the shell has no footer line");
  return `${head}<body>\n${main}${foot}</body>\n</html>\n`;
}

export async function site(out = join(ROOT, "dist/site"), sitekey = process.env.TURNSTILE_SITEKEY || TEST_SITEKEY) {
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "_app"), { recursive: true });
  const tokens = await readFile(join(ROOT, "site/tokens.css"), "utf8"), { light, dark } = palette(tokens);
  const html = (await readFile(join(ROOT, "site/index.html"), "utf8")).replace("__SITEKEY__", () => sitekey).replace("__VERSION__", () => VERSION)
    .replace("__PAPER__", () => light.paper).replace("__PAPER_DARK__", () => dark.paper);
  for (const m of [MARK, CARD_MARK]) if (html.split(m).length !== 2) throw new Error(`site/index.html: needs ${JSON.stringify(m)} exactly once`);
  // Awaited here, together: an await inside the array below would hold back every entry after it.
  // One pipeline run feeds the home's example and the card's words.
  const ex = excerpt();
  const shell = splice(splice(html, ""), "", CARD_MARK);
  const [app, example, alt, worker, css] = await Promise.all([
    build({ entryPoints: [join(ROOT, "site/app.js")], bundle: true, format: "esm", platform: "browser", minify: true, write: false, logLevel: "silent" }),
    exampleHtml(ex), cardWords(ex).then(cardAlt), bundle().then(async (b) => `${b}\n${await readFile(join(ROOT, "site/worker.js"), "utf8")}`), stylesheet(),
  ]);
  await Promise.all([
    writeFile(join(out, "index.html"), shell),
    readFile(join(ROOT, "site/privacy.html"), "utf8").then((main) => writeFile(join(out, "privacy.html"), privacyPage(shell, main))),
    writeFile(join(out, "_app/home.html"), splice(splice(cut(html, NOINDEX, "site/index.html"), `${example}\n`), homeTags + cardTags(alt), CARD_MARK)),
    writeFile(join(out, "_app/app.js"), app.outputFiles[0].text),
    copyFile(join(ROOT, "site/theme.js"), join(out, "_app/theme.js")),
    writeFile(join(out, "_app/icon.svg"), iconSvg(tokens)),
    writeFile(join(out, "_app/touch.png"), iconPng(tokens, 180, 9)),
    writeFile(join(out, "favicon.ico"), iconIco(tokens)),
    copyFile(join(ROOT, CARD.file), join(out, "_app/card.png")),
    writeFile(join(out, "_app/worker.js"), worker),
    writeFile(join(out, "_app/style.css"), css),
    cp(join(ROOT, "site/fonts"), join(out, "_app/fonts"), { recursive: true }),
    copyFile(join(ROOT, "site/_headers"), join(out, "_headers")),
    copyFile(join(ROOT, "site/_routes.json"), join(out, "_routes.json")),
    copyFile(join(ROOT, "site/_redirects"), join(out, "_redirects")),
    copyFile(join(ROOT, "site/robots.txt"), join(out, "robots.txt")),
  ]);
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.env.TURNSTILE_SITEKEY) console.error(`TURNSTILE_SITEKEY unset: built with Cloudflare's always-pass test key ${TEST_SITEKEY}; local use only, a deploy needs the real key`);
  console.log(await site());
}
