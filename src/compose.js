// Navigation shell: wraps a page in a section tree built from its own navigation
// (breadcrumbs, rel=next/prev/up). When sibling content is provided (canonical url -> blocks),
// the prev/next sections carry real blocks instead of empty stubs. Order is preserved: prev
// before page before next. This is not a crawl; it attaches only the provided siblings.
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

// Build a Document whose section tree reflects the page's position in the docs site:
// breadcrumb ancestors wrap the page, and prev/next are ordered siblings, each with content
// when siblingBlocks supplies it. nav is extractNav's result for this page.
export function compose({ url, html, nav, title, blocks, losses = [], source, generator, siblingBlocks = {} }) {
  const page = ir.section(ir.stableId(url), title || norm(extractPageTitle(html)) || url, { url });
  page.blocks = blocks;
  page.losses = losses;

  const mk = (r, fallback) => {
    if (!r || !r.url) return null;
    const sb = siblingBlocks[r.url];
    const s = ir.section(ir.stableId(r.url), (sb && sb.title) || r.title || fallback, { url: r.url });
    if (sb) { s.blocks = sb.blocks; s.losses = sb.losses ?? []; }
    return s;
  };
  const prev = mk(nav.rel.prev, "Previous");
  const next = mk(nav.rel.next, "Next");

  // Ancestor chain from breadcrumbs wraps the page. A crumb that links to the page itself is
  // the page, not an ancestor: skip it, or its section id collides with the page and the
  // prev/next splice below targets the wrong parent, dropping the siblings.
  let root = page;
  for (let i = nav.breadcrumbs.length - 1; i >= 0; i--) {
    const a = nav.breadcrumbs[i];
    if (ir.stableId(a.url) === page.id) continue;
    const s = ir.section(ir.stableId(a.url), a.title, { url: a.url });
    s.children.push(root);
    root = s;
  }
  if (root === page && nav.rel.up) {
    const up = ir.section(ir.stableId(nav.rel.up.url), nav.rel.up.title || "Parent", { url: nav.rel.up.url });
    up.children.push(page);
    root = up;
  }

  if (root === page) {
    // No parent: the document's top-level sections are the ordered siblings.
    return ir.document({
      id: ir.stableId(url),
      title: title || "Document",
      source,
      generator,
      sections: [prev, page, next].filter(Boolean),
    });
  }

  // Siblings go around the page in its immediate parent's children list.
  const parent = immediateParent(root, page.id) ?? root;
  const idx = parent.children.indexOf(page);
  if (idx >= 0) {
    if (prev) parent.children.splice(idx, 0, prev);
    const after = parent.children.indexOf(page);
    if (next) parent.children.splice(after + 1, 0, next);
  }

  return ir.document({
    id: ir.stableId(url),
    title: title || nav.rel.up?.title || "Document",
    source,
    generator,
    sections: [root],
  });
}

function immediateParent(node, targetId) {
  for (const c of node.children) {
    if (c.id === targetId) return node;
    const found = immediateParent(c, targetId);
    if (found) return found;
  }
  return null;
}

function extractPageTitle(html) {
  const { document } = parseHTML(html);
  const h1 = document.querySelector("h1");
  if (h1) return norm(h1.textContent);
  const t = document.querySelector("title");
  return t ? norm(t.textContent) : "";
}
