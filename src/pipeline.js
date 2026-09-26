// The core pipeline: fetch -> extract -> IR -> {markdown, json}. Deterministic for a
// fixed snapshot AND pinned retrievedAt: same html + same version + same retrievedAt -> same
// document. Live fetch bakes in the retrieval time, so live runs differ.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fetchSnapshot } from "./fetch.js";
import { extract, EXTRACTOR, EXTRACTOR_VERSION } from "./extract.js";
import { contentToBlocks } from "./to-ir.js";
import { auditSourceLoss, restoreCodeLayout } from "./loss-audit.js";
import { isIP } from "node:net";
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
  const blocks = restoreCodeLayout(html, extracted.filter((b) => b.type !== "loss"));
  const losses = [...extracted.filter((b) => b.type === "loss"), ...auditSourceLoss(html, blocks, title)];
  return { blocks, losses };
}

// Fetch, extract, and partition one sibling (a canonical URL from extractNav). A dead or
// blocked sibling is a status in doc.scope, not a failure of the whole document.
async function buildSibling(surl, fetch) {
  // SSRF pre-check: sibling URLs come from page nav (untrusted), so reject a literal private
  // address before the fetch. Hostnames still rely on fetchSnapshot's pinned lookup.
  const host = new URL(surl).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateIp(host)) return { status: "blocked", url: surl };
  try {
    const sib = await fetch(surl);
    const docHtml = sib.html;
    // Extract against the URL actually read, so relative links resolve after a redirect.
    const sex = await extract(docHtml, sib.finalUrl ?? surl);
    const { blocks, losses } = separateLosses(contentToBlocks(sex.contentHtml), docHtml, sex.title);
    return { status: "attached", url: surl, title: sex.title, blocks, losses };
  } catch {
    return { status: "failed", url: surl };
  }
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

  const ex = await extract(snap.html, snap.finalUrl);
  const { blocks, losses } = separateLosses(contentToBlocks(ex.contentHtml), snap.html, ex.title);

  // Nav is parsed once and drives both the frontier and the document. Sibling content is
  // fetched only on a live run; a pinned html snapshot never auto-fetches.
  const nav = extractNav(snap.html, snap.finalUrl);
  const siblings = {};
  await Promise.all(["prev", "next"].map(async (r) => {
    const link = nav.rel[r];
    siblings[r] = !link ? { status: "absent" }
      : html != null ? { status: "unfetched", url: link.url }
      : await buildSibling(link.url, fetch);
  }));

  const source = { url, finalUrl: snap.finalUrl, retrievedAt: snap.retrievedAt, fingerprint: snap.fingerprint };
  const generator = { name: "mdflow", version: VERSION, extractor: EXTRACTOR, extractorVersion: EXTRACTOR_VERSION };
  const doc = compose({ url: snap.finalUrl, html: snap.html, nav, title: ex.title, blocks, losses, source, generator, siblings });
  validate(doc);

  return { doc, markdown: renderMarkdown(doc), snapshot: snap, extract: ex };
}
