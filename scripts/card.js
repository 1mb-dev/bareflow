// The OG card: the home's example (tape band, chip, title) cropped to 1200x630 in the light theme,
// its smallest text 48 px. `node scripts/card.js` renders it in headless Chrome
// (CHROME=<path> to override), and writes site/card.png. The PNG carries what it shows (cardWords)
// in a tEXt chunk; verify recomputes it, so a card that no longer matches the example or the light
// tokens fails until this is run again. style.css is not fingerprinted: re-run after a change to
// the tape or the page title.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { excerpt, exampleHtml } from "./example.js";
import { chunk, chunks } from "./icon.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CARD = { file: "site/card.png", url: "https://bareflow.1mb.dev/_app/card.png", width: 1200, height: 630, key: "bareflow-card" };
// The tape's --t-small (13 px) at 48.75 px; 1200 and 630 must divide by it (a window of 320x168).
const SCALE = 3.75;

// What the card shows, and the light :root block it is drawn with (values only: comments, spacing,
// and the dark theme do not move it).
export async function cardWords() {
  const { doc } = await excerpt();
  const n = doc.sections[0].losses.length;
  const css = await readFile(join(ROOT, "site/tokens.css"), "utf8"), at = css.indexOf(":root {");
  const tokens = css.slice(at, css.indexOf("}", at) + 1).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  return { chip: `${n} loss${n === 1 ? "" : "es"}`, from: `from ${new URL(doc.source.url).hostname}, not 1mb.dev`, title: doc.title, tokens: createHash("sha256").update(tokens).digest("hex") };
}
export const cardAlt = (w) => `bareflow's copy of "${w.title}", ${w.from}, ${w.chip} marked`;

export function cardText(png) {
  const t = chunks(png).find(([type, d]) => type === "tEXt" && d.toString("latin1").startsWith(`${CARD.key}\0`));
  return t ? JSON.parse(t[1].toString("latin1").slice(CARD.key.length + 1)) : null;
}
function withText(png, text) {
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), chunk("tEXt", Buffer.from(`${CARD.key}\0${text}`, "latin1")), png.subarray(iend)]);
}

async function render() {
  const words = await cardWords();
  const dir = await mkdtemp(join(tmpdir(), "bareflow-card-"));
  try {
    await mkdir(join(dir, "_app"));
    await writeFile(join(dir, "_app/style.css"), (await Promise.all(["site/tokens.css", "site/style.css"].map((f) => readFile(join(ROOT, f), "utf8")))).join("\n"));
    await cp(join(ROOT, "site/fonts"), join(dir, "_app/fonts"), { recursive: true });
    // The crop: the tape full-bleed at the top, then the page; no captions, box, or losses.
    await writeFile(join(dir, "card.html"), `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<link rel="stylesheet" href="/_app/style.css"><style>
body { width: ${CARD.width / SCALE}px; overflow: hidden; } /* headless Chrome lays out wider than a small window */ .example > h2, .exhibit .caption, .exhibit > figcaption, .exhibit-part:nth-child(3), .elision { display: none; }
.exhibit { border: 0; } .exhibit-part:first-child { padding: 0; }
</style></head><body>${await exampleHtml()}</body></html>`);
    const types = { ".html": "text/html", ".css": "text/css", ".woff2": "font/woff2" };
    const server = createServer(async (req, res) => {
      const f = join(dir, normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)));
      try { const b = await readFile(f); res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" }); res.end(b); } catch { res.writeHead(404); res.end(); }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const shot = join(dir, "card.png");
    const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    // Async: the server above answers Chrome from this process.
    await new Promise((resolve, reject) => execFile(chrome, ["--headless", "--hide-scrollbars", "--force-color-profile=srgb", `--force-device-scale-factor=${SCALE}`,
      `--window-size=${CARD.width / SCALE},${CARD.height / SCALE}`, "--virtual-time-budget=5000", `--screenshot=${shot}`,
      `http://127.0.0.1:${server.address().port}/card.html`], { timeout: 60000 }, (e, out, err) => (e ? reject(new Error(`chrome: ${e.message} ${err}`)) : resolve())));
    server.close();
    const png = await readFile(shot);
    const ihdr = chunks(png)[0][1];
    if (ihdr.readUInt32BE(0) !== CARD.width || ihdr.readUInt32BE(4) !== CARD.height) throw new Error(`chrome wrote ${ihdr.readUInt32BE(0)}x${ihdr.readUInt32BE(4)}, not ${CARD.width}x${CARD.height}`);
    await writeFile(join(ROOT, CARD.file), withText(png, JSON.stringify(words)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await render();
  console.log(CARD.file);
}
