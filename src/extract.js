// Compose Defuddle as the extraction core. This module is the only place the extractor
// is referenced: it takes raw HTML + url and returns Defuddle's content HTML + metadata.
// The contract downstream (IR, composer, snapshot, loss) does not depend on Defuddle.
import { parseHTML } from "linkedom";
import { Defuddle } from "defuddle/node";
import { readFileSync } from "node:fs";

export const EXTRACTOR = "defuddle";
export const EXTRACTOR_VERSION = JSON.parse(
  readFileSync(new URL("../node_modules/defuddle/package.json", import.meta.url), "utf8")
).version;

export async function extract(html, url) {
  const { document } = parseHTML(html);
  const res = await Defuddle(document, url);
  return {
    extractor: EXTRACTOR,
    extractorVersion: EXTRACTOR_VERSION,
    title: res.title || "",
    contentHtml: res.content || "",
  };
}
