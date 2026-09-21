// Phase 0: structural + hygiene metrics over each extractor's markdown output.
// Emits data/meta/metrics.json and prints a per-page table.
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(await readFile(join(ROOT, "corpus.json"), "utf8"));

const CHROME = [
  /\blog\s*in\b/i, /\bsign\s*(in|up|out)\b/i, /create\s+account/i, /get\s+started/i,
  /\bcookie(s)?\b/i, /privacy\s+policy/i, /terms\s+of\s+(service|use)/i, /terms\s*&\s*conditions/i,
  /subscribe/i, /newsletter/i, /follow\s+us/i, /share\s+this/i, /\b(advertise(ment)?|sponsor(ed)?)\b/i,
  /all\s+rights\s+reserved/i, /copyright/i, /\bdark\s+mode\b/i, /\blight\s+mode\b/i,
  /\btoggle\s+(theme|language)\b/i, /\bsearch\b\s*(docs)?\s*$/im, /ctrl\s*\+?\s*k/i, /⌘\s*k/,
  /made\s+with/i, /powered\s+by/i, /built\s+with/i, /edit\s+this\s+page/i, /report\s+(an?\s+)?issue/i,
  /\b(donate|merch|swag|store)\b/i,
];
const LOSS_MARKERS = [
  /warning:/i, /unsupported/i, /not\s+supported/i, /shadow\s+dom/i, /captcha/i,
  /\[image\s*\d*:?/i, /\[video\s*\d*:?/i, /\[audio\s*\d*:?/i, /\[object\s+object\]/i,
  /…{2,}/, /\.\.\.\s*$/, /image\s+not\s+(available|found)/i, /iframe/i, /\[embedded/i,
];
const NAV_TOKENS = [/\bprevious\b/i, /\bnext\b/i, /\bbreadcrumb/i, /\bon this page\b/i, /\btable of contents\b/i];

function metrics(md) {
  if (!md) return null;
  const lines = md.split("\n");
  const m = {
    chars: md.length,
    words: md.split(/\s+/).filter(Boolean).length,
    headings: { h1: 0, h2: 0, h3: 0, h4: 0 },
    fencedCode: 0,
    codeChars: 0,
    tableRows: 0,
    links: 0,
    images: 0,
    chrome: 0,
    loss: 0,
    nav: 0,
  };
  let inCode = false;
  for (const line of lines) {
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      inCode = !inCode;
      if (inCode) m.fencedCode++;
      continue;
    }
    if (inCode) {
      m.codeChars += line.length + 1;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      if (lvl === 1) m.headings.h1++;
      else if (lvl === 2) m.headings.h2++;
      else if (lvl === 3) m.headings.h3++;
      else m.headings.h4++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && line.includes("|")) m.tableRows++;
    // links/images outside code
    m.links += (line.match(/\[[^\]]*\]\([^)]*\)/g) || []).length;
    m.images += (line.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;
    // hygiene
    if (CHROME.some((re) => re.test(line))) m.chrome++;
    if (LOSS_MARKERS.some((re) => re.test(line))) m.loss++;
    if (NAV_TOKENS.some((re) => re.test(line))) m.nav++;
  }
  return m;
}

const out = {};
const rows = [];
const SHORT = { readability: "rd", defuddle: "df", jina: "ji" };
for (const it of corpus.items) {
  out[it.id] = { category: it.category, url: it.url, extractors: {} };
  const row = { id: it.id, cat: it.category };
  for (const ex of ["readability", "defuddle", "jina"]) {
    const md = await readFile(join(ROOT, "data/out", ex, `${it.id}.md`), "utf8").catch(() => null);
    const met = metrics(md);
    out[it.id].extractors[ex] = met;
    const p = SHORT[ex];
    if (met) {
      row[`${p}_w`] = met.words;
      row[`${p}_h`] = met.headings.h2 + met.headings.h3;
      row[`${p}_code`] = met.fencedCode;
      row[`${p}_tbl`] = met.tableRows;
      row[`${p}_lnk`] = met.links;
      row[`${p}_chr`] = met.chrome;
      row[`${p}_loss`] = met.loss;
    } else {
      for (const k of ["_w", "_h", "_code", "_tbl", "_lnk", "_chr", "_loss"]) row[p + k] = null;
    }
  }
  rows.push(row);
}

await writeFile(join(ROOT, "data/meta/metrics.json"), JSON.stringify(out, null, 2));

// compact table
const header = ["id", "cat", "rd_w", "df_w", "ji_w", "rd_h", "df_h", "ji_h", "rd_code", "df_code", "ji_code", "rd_tbl", "df_tbl", "ji_tbl", "rd_chr", "df_chr", "ji_chr", "rd_loss", "df_loss", "ji_loss"];
const print = (v) => (v === null || v === undefined ? "·" : String(v));
console.log(header.join("\t"));
for (const r of rows) {
  console.log(header.map((k) => print(r[k])).join("\t"));
}
