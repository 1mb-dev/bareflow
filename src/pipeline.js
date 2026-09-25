// The core pipeline: fetch -> extract -> IR -> {markdown, json}. Deterministic for a
// fixed snapshot AND pinned retrievedAt: same html + same version + same retrievedAt -> same
// document. Live fetch bakes in the retrieval time, so live runs differ.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fetchSnapshot } from "./fetch.js";
import { extract, EXTRACTOR, EXTRACTOR_VERSION } from "./extract.js";
import { contentToBlocks } from "./to-ir.js";
import { auditSourceLoss } from "./loss-audit.js";
import { isPrivateIp } from "./ssrf.js";
import { compose, extractNav } from "./compose.js";
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

// Fetch, extract, and partition one sibling (a canonical URL from extractNav) into blocks +
// losses. A dead sibling returns null so it degrades to a title-only stub rather than failing
// the whole document.
async function buildSibling(surl, fetch) {
  // SSRF pre-check: sibling URLs come from page nav (untrusted), so reject a literal private
  // address before the fetch. Hostnames still rely on fetchSnapshot's pinned lookup.
  if (isPrivateIp(new URL(surl).hostname.replace(/^\[|\]$/g, ""))) return null;
  let docHtml;
  try { docHtml = (await fetch(surl)).html; } catch { return null; }
  const sex = await extract(docHtml, surl);
  const { blocks, losses } = separateLosses(contentToBlocks(sex.contentHtml), docHtml, sex.title);
  return { url: surl, title: sex.title, blocks, losses };
}

export async function run({ url, html, retrievedAt, fetch = fetchSnapshot }) {
  let snap;
  if (html != null) {
    snap = {
      url, finalUrl: url, status: 200, contentType: "text/html",
      bytes: Buffer.byteLength(html), html,
      fingerprint: sha(html), retrievedAt: retrievedAt ?? new Date().toISOString(),
    };
  } else {
    snap = await fetch(url);
  }

  const ex = await extract(snap.html, url);
  const { blocks, losses } = separateLosses(contentToBlocks(ex.contentHtml), snap.html, ex.title);

  // Nav is parsed once and drives both the frontier and the section tree. Sibling content is
  // fetched only on a live run; a pinned html snapshot never auto-fetches. rel=up stays a
  // title-only structural parent, like the breadcrumb ancestors.
  const nav = extractNav(snap.html, snap.finalUrl);
  const frontier = html == null ? [nav.rel.prev, nav.rel.next].filter((r) => r?.url) : [];
  const built = await Promise.all(frontier.map((r) => buildSibling(r.url, fetch)));
  const siblingBlocks = {};
  for (const b of built) if (b) siblingBlocks[b.url] = { title: b.title, blocks: b.blocks, losses: b.losses };

  const source = { url, finalUrl: snap.finalUrl, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint };
  const generator = { name: "mdflow", version: VERSION, extractor: EXTRACTOR, extractorVersion: EXTRACTOR_VERSION };
  const doc = compose({ url: snap.finalUrl, html: snap.html, nav, title: ex.title, blocks, losses, source, generator, siblingBlocks });
  validate(doc);

  return { doc, markdown: renderMarkdown(doc), snapshot: snap, extract: ex };
}
