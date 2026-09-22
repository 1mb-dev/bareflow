// The core pipeline: fetch -> extract -> IR -> {markdown, json}. Deterministic for a
// fixed snapshot AND pinned retrievedAt: same html + same config + same version + same
// retrievedAt -> same document. Live fetch bakes in the retrieval time, so live runs differ.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fetchSnapshot } from "./fetch.js";
import { extract, EXTRACTOR, EXTRACTOR_VERSION } from "./extract.js";
import { contentToBlocks } from "./to-ir.js";
import { auditSourceLoss } from "./loss-audit.js";
import { compose } from "./compose.js";
import { validate } from "./ir.js";
import { renderMarkdown } from "./render.js";

const require = createRequire(import.meta.url);
export const VERSION = require("../package.json").version;
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// Split extraction output into content blocks and loss markers, then append the source-loss
// audit's drops. Loss markers are findings, not content, so they live in section.losses.
function separateLosses(extracted, html, title) {
  const blocks = extracted.filter((b) => b.type !== "loss");
  const losses = [...extracted.filter((b) => b.type === "loss"), ...auditSourceLoss(html, blocks, title)];
  return { blocks, losses };
}

export const DEFAULT_CONFIG = {};

export async function run({ url, html, siblings = {}, config = DEFAULT_CONFIG, retrievedAt }) {
  let snap;
  if (html != null) {
    snap = {
      url, finalUrl: url, status: 200, contentType: "text/html",
      bytes: Buffer.byteLength(html), html,
      fingerprint: sha(html), retrievedAt: retrievedAt ?? new Date().toISOString(),
    };
  } else {
    snap = await fetchSnapshot(url);
  }

  const ex = await extract(snap.html, url);
  const { blocks, losses } = separateLosses(contentToBlocks(ex.contentHtml), snap.html, ex.title);

  // Pinned sibling snapshots: extract each so prev/next sections carry real content.
  const siblingBlocks = {};
  for (const [surl, shtml] of Object.entries(siblings)) {
    let canonical;
    try { canonical = new URL(surl).toString(); } catch { continue; } // malformed sibling key: skip, becomes a stub
    const sex = await extract(shtml, canonical);
    const { blocks: sblocks, losses: slosses } = separateLosses(contentToBlocks(sex.contentHtml), shtml, sex.title);
    siblingBlocks[canonical] = { title: sex.title, blocks: sblocks, losses: slosses };
  }

  const source = { url, finalUrl: snap.finalUrl, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint };
  const generator = { name: "mdflow", version: VERSION, extractor: EXTRACTOR, extractorVersion: EXTRACTOR_VERSION, config };
  const doc = compose({ url: snap.finalUrl, html: snap.html, title: ex.title, blocks, losses, source, generator, siblingBlocks });
  validate(doc);

  return { doc, markdown: renderMarkdown(doc), snapshot: snap, extract: ex };
}
