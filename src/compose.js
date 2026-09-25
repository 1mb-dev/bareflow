// Navigation: reads a page's own nav (rel=prev/next/up, breadcrumbs) and composes the page
// with whichever prev/next siblings were attached. This is not a crawl; it attaches only the
// provided siblings, and doc.scope says what the result covers.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// The one URL canonicalizer: nav targets, sibling keys, and nav truth all compare through it.
// null for an href that does not resolve or is not http(s): a nav target of a web document is
// a web page, never javascript: or file:.
export function canonicalUrl(href, base) {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

// rel is a token list on <link> and <a> alike ("next prefetch" is next); only the standard
// prev/next/up keywords count. Two different targets for one relation are ambiguous and
// attach neither: a wrong sibling is worse than none.
export function extractNav(html, url) {
  const { document } = parseHTML(html);
  const found = {};
  for (const el of document.querySelectorAll("link[rel][href], a[rel][href]")) {
    const target = canonicalUrl(el.getAttribute("href"), url);
    if (!target) continue;
    for (const r of (el.getAttribute("rel") || "").toLowerCase().split(/\s+/)) {
      if (r === "next" || r === "prev" || r === "up") (found[r] ??= []).push({ title: norm(el.getAttribute("title")), url: target });
    }
  }
  const rel = {};
  for (const [r, list] of Object.entries(found)) if (new Set(list.map((x) => x.url)).size === 1) rel[r] = list[0];
  const breadcrumbs = [];
  const bc = document.querySelector('nav[aria-label*="readcrumb" i], .breadcrumbs, [class*="breadcrumb" i]');
  if (bc) {
    for (const a of bc.querySelectorAll("a[href]")) {
      const t = norm(a.textContent);
      const target = canonicalUrl(a.getAttribute("href"), url);
      if (t && target) breadcrumbs.push({ title: t, url: target });
    }
  }
  return { rel, breadcrumbs };
}

// Build a Document: the page plus whichever prev/next siblings were attached, in order. The
// result is a window onto the docs section, not the section, and says so in doc.scope; where
// the page sits (breadcrumbs, else rel=up) is doc.breadcrumbs, not empty ancestor sections.
// nav is extractNav's result for this page; siblings maps prev/next to { status, url?, title?,
// blocks?, losses? } with status attached | unfetched | failed | blocked | absent.
export function compose({ url, html, nav, title, blocks, losses = [], source, generator, siblings }) {
  const page = ir.section(ir.stableId(url), title || norm(extractPageTitle(html)) || url, { url });
  page.blocks = blocks;
  page.losses = losses;

  const attached = (r) => {
    const s = siblings[r];
    if (s.status !== "attached") return null;
    const sec = ir.section(ir.stableId(s.url), s.title || nav.rel[r]?.title || s.url, { url: s.url });
    sec.blocks = s.blocks;
    sec.losses = s.losses;
    return sec;
  };
  const sections = [attached("prev"), page, attached("next")].filter(Boolean);

  // A crumb that links to the page itself is the page, not a place above it.
  const trail = nav.breadcrumbs.filter((c) => c.url !== url);
  const breadcrumbs = trail.length ? trail : nav.rel.up ? [{ title: nav.rel.up.title, url: nav.rel.up.url }] : [];

  const status = (r) => ({ status: siblings[r].status, ...(siblings[r].url ? { url: siblings[r].url } : {}) });
  const scope = { kind: sections.length > 1 ? "window" : "page", siblings: { prev: status("prev"), next: status("next") } };

  return ir.document({ id: ir.stableId(url), title: title || "Document", source, generator, scope, breadcrumbs, sections });
}

function extractPageTitle(html) {
  const { document } = parseHTML(html);
  const h1 = document.querySelector("h1");
  if (h1) return norm(h1.textContent);
  const t = document.querySelector("title");
  return t ? norm(t.textContent) : "";
}
