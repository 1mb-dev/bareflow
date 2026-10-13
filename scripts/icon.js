// The icon: the tape as a bar with the loss chip as a notch inside it, on a 16-unit grid, in
// tokens.css's colors. icon.svg follows the system theme (a dark bar needs a light edge to show on
// a dark tab strip); the PNGs (touch icon, favicon.ico) are opaque on paper, since iOS fills
// transparency with black and an .ico cannot follow the theme.
import { deflateSync, crc32 } from "node:zlib";

// x, y, w, h in grid units. The notch stays inside the bar, clear of the dark edge: on paper an
// edge notch would vanish (--mark on white is 1.3:1).
export const BAR = [0, 3, 16, 10], NOTCH = [9, 6, 5, 4], EDGE = 1;

// A theme's colors by token, from a block of tokens.css (light: the first :root).
export function palette(tokens) {
  const block = (sel) => { const at = tokens.indexOf(`${sel} {`); return Object.fromEntries([...tokens.slice(at, tokens.indexOf("}", at)).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]])); };
  const light = block(":root"), dark = block(':root[data-theme="dark"]');
  return { light: { paper: light.paper, bar: light.tape, notch: light.mark }, dark: { paper: dark.paper, bar: dark.tape, edge: dark["tape-ink-2"], notch: dark.mark } };
}

export function iconSvg(tokens) {
  const { light, dark } = palette(tokens);
  const rect = (cls, [x, y, w, h]) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  const [x, y, w, h] = BAR, e = EDGE / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
<style>.bar{fill:${light.bar}}.notch{fill:${light.notch}}.edge{fill:none;stroke:none}
@media (prefers-color-scheme: dark){.bar{fill:${dark.bar}}.notch{fill:${dark.notch}}.edge{stroke:${dark.edge};stroke-width:${EDGE}}}</style>
${rect("bar", BAR)}${rect("edge", [x + e, y + e, w - EDGE, h - EDGE])}${rect("notch", NOTCH)}
</svg>
`;
}

export const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

// PNG chunks: [type, data] in order.
export function chunks(png) {
  const out = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    out.push([png.toString("latin1", at + 4, at + 8), png.subarray(at + 8, at + 8 + len)]);
    at += 12 + len;
  }
  return out;
}

// An opaque RGB PNG of the light icon on paper, the grid scaled by `scale` and centred in `size`.
export function iconPng(tokens, size, scale) {
  const { light } = palette(tokens);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pad = (size - 16 * scale) / 2;
  if (!Number.isInteger(pad) || pad < 0) throw new Error(`icon: 16 x ${scale} does not centre in ${size}`);
  const inside = ([x, y, w, h], px, py) => px >= pad + x * scale && px < pad + (x + w) * scale && py >= pad + y * scale && py < pad + (y + h) * scale;
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const c = rgb(inside(NOTCH, px, py) ? light.notch : inside(BAR, px, py) ? light.bar : light.paper);
      rows.set(c, py * (1 + size * 3) + 1 + px * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no alpha
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// favicon.ico: one 32 px PNG entry.
export function iconIco(tokens) {
  const png = iconPng(tokens, 32, 2);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(1, 4);
  head.set([32, 32, 0, 0], 6);
  head.writeUInt16LE(1, 10);
  head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
