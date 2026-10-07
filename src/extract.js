// Compose Defuddle as the extraction core. This module is the only place the extractor
// is referenced: it takes raw HTML + url and returns Defuddle's content HTML + metadata.
// The contract downstream (IR, composer, snapshot, loss) does not depend on Defuddle.
import { parseHtml } from "./html.js";
import { Defuddle } from "defuddle/node";
import { EXTRACTOR_VERSION } from "./version.js";

export const EXTRACTOR = "defuddle";

export async function extract(html, url) {
  const { document } = parseHtml(html);
  const res = await Defuddle(document, url);
  return {
    extractor: EXTRACTOR,
    extractorVersion: EXTRACTOR_VERSION,
    title: res.title || "",
    contentHtml: res.content || "",
  };
}
