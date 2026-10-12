// Navigation: reads a page's own nav (rel=prev/next/up, breadcrumbs) and composes the page
// document. Nav targets are document structure, recorded in doc.scope and doc.breadcrumbs;
// bareflow never fetches them.
import { parseHtml } from "./html.js";
import * as ir from "./ir.js";

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// The one URL canonicalizer: nav targets and nav truth compare through it.
// null for an href that does not resolve or is not http(s): a nav target of a web document is
// a web page, never javascript: or file:.
export function canonicalUrl(href, base) {
  try {
    const u = new URL(href, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

// Two URLs name the same page when they differ only by fragment or a trailing slash.
const samePage = (a, b) => {
  const key = (u) => u.replace(/#.*$/, "").replace(/\/$/, "");
  return key(a) === key(b);
};

// Docs pagers that a generator renders without rel, keyed on the generator the page declares
// in <meta name=generator>. Data, not branches: one row per generator, admitted only with
// frozen fixtures it fixes. No declared generator, or a theme with its own pager (vuejs.org),
// means rel only. Docusaurus blog posts share the pager classes; older/newer posts are not
// document siblings, so the row requires a docs page.
const PAGERS = [
  { generator: /^Docusaurus\b/, prev: "html.docs-doc-page nav.pagination-nav a.pagination-nav__link--prev", next: "html.docs-doc-page nav.pagination-nav a.pagination-nav__link--next" },
  { generator: /^VitePress\b/, prev: "nav.prev-next a.pager-link.prev", next: "nav.prev-next a.pager-link.next" },
];

// rel is a token list on <link> and <a> alike ("next prefetch" is next); only the standard
// prev/next/up keywords count. A nav target must be another page on the same origin: a link to
// the page itself or to another site (user content can carry rel=next) is ignored. Two
// different targets for one relation are ambiguous and record neither: a wrong target is
// worse than none. rel wins; a generator's pager fills only a relation rel leaves empty.
export function extractNav(html, url) {
  const { document } = parseHtml(html);
  const page = canonicalUrl(url);
  const origin = page && new URL(page).origin;
  const target = (el) => {
    const t = canonicalUrl(el.getAttribute("href"), url);
    return t && new URL(t).origin === origin && !samePage(t, page) ? t : null;
  };
  const found = {};
  for (const el of document.querySelectorAll("link[rel][href], a[rel][href]")) {
    const t = target(el);
    if (!t) continue;
    for (const r of (el.getAttribute("rel") || "").toLowerCase().split(/\s+/)) {
      if (r === "next" || r === "prev" || r === "up") (found[r] ??= []).push({ title: norm(el.getAttribute("title")), url: t, via: "rel" });
    }
  }
  const generator = document.querySelector('meta[name="generator" i]')?.getAttribute("content") ?? "";
  const pager = PAGERS.find((p) => p.generator.test(generator.trim()));
  for (const r of pager ? ["prev", "next"] : []) {
    if (found[r]) continue;
    for (const el of document.querySelectorAll(`${pager[r]}[href]`)) {
      const t = target(el);
      if (t) (found[r] ??= []).push({ title: "", url: t, via: "pager" });
    }
  }
  const rel = {};
  for (const [r, list] of Object.entries(found)) if (new Set(list.map((x) => x.url)).size === 1) rel[r] = list[0];
  const breadcrumbs = [];
  // The trail container, never <html>/<body> (a body class like "has-breadcrumbs" matches).
  const bc = [...document.querySelectorAll('nav[aria-label*="readcrumb" i], .breadcrumbs, [class*="breadcrumb" i]')]
    .find((el) => el.tagName !== "BODY" && el.tagName !== "HTML" && el.querySelector("a[href]"));
  if (bc) {
    for (const a of bc.querySelectorAll("a[href]")) {
      const t = norm(a.textContent);
      const target = canonicalUrl(a.getAttribute("href"), url);
      // Held to the page's origin like rel and pager targets: a crumb on another site is not a
      // place in this one.
      if (t && target && new URL(target).origin === origin) breadcrumbs.push({ title: t, url: target });
    }
  }
  return { rel, breadcrumbs };
}

// Build a Document: one page section. Its prev/next nav targets go in doc.scope; where the page
// sits (breadcrumbs, else rel=up) is doc.breadcrumbs, not empty ancestor sections. nav is
// extractNav's result for this page.
export function compose({ url, nav, title, blocks, losses = [], source, generator }) {
  // Titles are page text on one line: a newline in <title> must not forge render lines.
  title = norm(title);
  const page = ir.section(ir.stableId(url), title || url, { url });
  page.blocks = blocks;
  page.losses = losses;

  // A crumb that links to the page itself is the page, not a place above it.
  const trail = nav.breadcrumbs.filter((c) => !samePage(c.url, canonicalUrl(url) ?? url));
  const breadcrumbs = trail.length ? trail : nav.rel.up ? [{ title: nav.rel.up.title, url: nav.rel.up.url }] : [];

  const scope = { kind: "page" };
  for (const r of ["prev", "next"]) if (nav.rel[r]) scope[r] = { url: nav.rel[r].url, via: nav.rel[r].via };

  return ir.document({ id: ir.stableId(url), title: title || "Document", source, generator, scope, breadcrumbs, sections: [page] });
}
