// The conversion: one page's HTML -> IR -> {markdown, json}, no fetch. Deterministic: same html,
// url, retrievedAt, fingerprint, and input, same version -> same document. The fingerprint is the
// fetched bytes' when a fetch made them, else the HTML's. Nothing on this path may need Node: the
// browser bundle runs it, and verify's parity check fails on a node: import, Buffer, or process.
import { extract, EXTRACTOR } from "./extract.js";
import { contentToBlocks } from "./to-ir.js";
import { auditSourceLoss, restoreCodeLayout, sourceTitle } from "./loss-audit.js";
import { compose, extractNav } from "./compose.js";
import { validate } from "./ir.js";
import { renderMarkdown } from "./render.js";
import { VERSION, EXTRACTOR_VERSION } from "./version.js";
import { unescape } from "./md.js";
import { sha256 } from "./sha256.js";

export function checkUrl(url) {
  try { new URL(url); } catch { throw new Error(`not a URL: ${url}; give a full http(s) URL`); }
}

// Split extraction output into content blocks and loss markers, then append the source-loss
// audit's drops. Loss markers are findings, not content, so they live in section.losses.
function separateLosses(extracted, html, extractedTitle) {
  const { title, blocks } = promoteTitle(extractedTitle, html, restoreCodeLayout(html, extracted.filter((b) => b.type !== "loss")));
  const losses = [...extracted.filter((b) => b.type === "loss"), ...auditSourceLoss(html, blocks, title)];
  return { title, blocks, losses };
}

// A site title is the page's heading, then the site's name ("Path | Node.js Documentation"), and
// the extractor sometimes keeps the wrong half. When the page part (the first) of the extracted
// title or of the page's <title> equals the leading heading, that heading is the title and leaves
// the body. The site-name part never counts: a leading brand heading must not become the title.
const SITE_SEP = /\s+[|\-\u2013\u2014\u00b7:]\s+/;
function promoteTitle(title, html, blocks) {
  // The title is plain text; an IR heading is inline Markdown, so it is compared and kept unescaped.
  const head = blocks[0]?.type === "heading" ? unescape(blocks[0].text).trim() : "";
  const lead = head.toLowerCase();
  const page = (t) => (t || "").split(SITE_SEP)[0].trim().toLowerCase();
  if (lead && (page(title) === lead || page(sourceTitle(html)) === lead)) return { title: head, blocks: blocks.slice(1) };
  return { title: title || sourceTitle(html), blocks };
}

export async function convert({ url, finalUrl = url, html, retrievedAt, fingerprint = sha256(html).slice(0, 16), input }) {
  checkUrl(url);
  const ex = await extract(html, finalUrl);
  const { title, blocks, losses } = separateLosses(contentToBlocks(ex.contentHtml), html, ex.title);

  // Nav targets are recorded, never fetched: one run reads one page.
  const nav = extractNav(html, finalUrl);

  const source = { url, finalUrl, retrievedAt, fingerprint, input };
  const generator = { name: "mdflow", version: VERSION, extractor: EXTRACTOR, extractorVersion: EXTRACTOR_VERSION };
  const doc = compose({ url: finalUrl, nav, title, blocks, losses, source, generator });
  validate(doc);

  return { doc, markdown: renderMarkdown(doc) };
}
