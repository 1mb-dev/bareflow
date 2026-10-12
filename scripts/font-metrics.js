// Fallback metrics: `node scripts/font-metrics.js <web.woff2> <local.ttf|ttc> [sample]` prints the
// @font-face descriptors that make the local face take the web face's space (size-adjust from the
// average advance over the sample, then ascent/descent/line-gap divided by it, as the browser
// multiplies the overrides by size-adjust). Run on a machine that has the local face; the output
// is pasted into site/tokens.css.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

const SAMPLE = "The page's words are the page's. bareflow never rewrites, summarizes, or styles them; every loss is named and numbered, and the original stays one link away.";
const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

function base128(b, at) {
  let v = 0;
  for (let i = 0; i < 5; i++) { const x = b[at.i++]; v = v * 128 + (x & 0x7f); if (!(x & 0x80)) return v; }
  throw new Error("bad UIntBase128");
}

// Table name -> { data, transformed }.
function tables(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = buf.toString("latin1", 0, 4);
  const out = {};
  if (sig === "wOF2") {
    const n = v.getUint16(12);
    const at = { i: 48 };
    const dir = [];
    for (let k = 0; k < n; k++) {
      const flags = buf[at.i++];
      const tag = (flags & 0x3f) === 0x3f ? buf.toString("latin1", at.i, (at.i += 4)) : KNOWN[flags & 0x3f];
      const version = flags >> 6;
      const orig = base128(buf, at);
      // glyf/loca: version 0 is transformed; every other table: version 0 is not.
      const transformed = (tag === "glyf" || tag === "loca") ? version === 0 : version !== 0;
      dir.push({ tag, transformed, length: transformed ? base128(buf, at) : orig });
    }
    const data = brotliDecompressSync(buf.subarray(at.i, at.i + v.getUint32(20)));
    let off = 0;
    for (const t of dir) { out[t.tag] = { data: data.subarray(off, off + t.length), transformed: t.transformed }; off += t.length; }
    return out;
  }
  const start = sig === "ttcf" ? v.getUint32(12) : 0;
  const n = v.getUint16(start + 4);
  for (let k = 0; k < n; k++) {
    const r = start + 12 + k * 16;
    out[buf.toString("latin1", r, r + 4)] = { data: buf.subarray(v.getUint32(r + 8), v.getUint32(r + 8) + v.getUint32(r + 12)), transformed: false };
  }
  return out;
}

const view = (t) => new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength);

// cmap format 4 (BMP) lookup.
function glyphOf(cmap) {
  const c = view(cmap);
  let sub = -1;
  for (let k = 0; k < c.getUint16(2); k++) {
    const off = c.getUint32(4 + k * 8 + 4);
    if (c.getUint16(off) === 4 && sub < 0) sub = off;
  }
  if (sub < 0) throw new Error("no cmap format 4");
  const segs = c.getUint16(sub + 6) / 2;
  const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
  return (code) => {
    for (let s = 0; s < segs; s++) {
      if (code > c.getUint16(ends + s * 2)) continue;
      const first = c.getUint16(starts + s * 2);
      if (code < first) return 0;
      const ro = c.getUint16(ranges + s * 2);
      if (!ro) return (code + c.getInt16(deltas + s * 2)) & 0xffff;
      const g = c.getUint16(ranges + s * 2 + ro + (code - first) * 2);
      return g ? (g + c.getInt16(deltas + s * 2)) & 0xffff : 0;
    }
    return 0;
  };
}

export function metrics(buf, sample = SAMPLE) {
  const t = tables(buf);
  const head = view(t.head), hhea = view(t.hhea), os2 = view(t["OS/2"]);
  const upm = head.getUint16(18);
  const nh = hhea.getUint16(34);
  // A transformed hmtx starts with a flags byte; the advances come first either way.
  const hmtx = view(t.hmtx), base = t.hmtx.transformed ? 1 : 0;
  const advance = (g) => hmtx.getUint16(base + Math.min(g, nh - 1) * (t.hmtx.transformed ? 2 : 4));
  const glyph = glyphOf(t.cmap);
  const widths = [...sample].map((ch) => advance(glyph(ch.codePointAt(0))));
  const axes = [];
  if (t.fvar) {
    const f = view(t.fvar), off = f.getUint16(4);
    for (let k = 0; k < f.getUint16(8); k++) {
      const a = off + k * f.getUint16(10);
      axes.push({ tag: Buffer.from(t.fvar.data.subarray(a, a + 4)).toString("latin1"), min: f.getInt32(a + 4) / 65536, def: f.getInt32(a + 8) / 65536, max: f.getInt32(a + 12) / 65536 });
    }
  }
  return {
    upm, ascent: hhea.getInt16(4), descent: -hhea.getInt16(6), lineGap: hhea.getInt16(8),
    typo: { ascent: os2.getInt16(68), descent: -os2.getInt16(70), lineGap: os2.getInt16(72), use: !!(os2.getUint16(62) & 0x80) },
    avg: widths.reduce((s, w) => s + w, 0) / widths.length / upm, axes,
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [web, local, sample] = process.argv.slice(2);
  const w = metrics(readFileSync(web), sample), l = metrics(readFileSync(local), sample);
  const size = w.avg / l.avg;
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(JSON.stringify({ web: w, local: l }, null, 1));
  console.log(`size-adjust: ${pct(size)}; ascent-override: ${pct(w.ascent / w.upm / size)}; descent-override: ${pct(w.descent / w.upm / size)}; line-gap-override: ${pct(w.lineGap / w.upm / size)};`);
}
