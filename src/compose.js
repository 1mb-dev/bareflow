// Navigation shell: wraps a page in a section tree built from its own navigation
// (breadcrumbs, rel=next/prev/up). When sibling content is provided (a pinned url -> html
// map), the prev/next sections carry real blocks instead of empty stubs. Order is preserved:
// prev before page before next. This is not a crawl; it attaches only the provided siblings.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function abs(href, base) {
  try { return new URL(href, base).toString(); } catch { return href; }
}

export function extractNav(html, url) {
  const { document } = parseHTML(html);
  const rel = {};
  for (const link of document.querySelectorAll("link[rel]")) {
    const r = (link.getAttribute("rel") || "").toLowerCase();
    if (r === "next" || r === "prev" || r === "up") {
      rel[r] = { title: norm(link.getAttribute("title")), url: abs(link.getAttribute("href"), url) };
    }
  }
  const breadcrumbs = [];
  const bc = document.querySelector('nav[aria-label*="readcrumb" i], .breadcrumbs, [class*="breadcrumb" i]');
  if (bc) {
    for (const a of bc.querySelectorAll("a[href]")) {
      const t = norm(a.textContent);
      if (t) breadcrumbs.push({ title: t, url: abs(a.getAttribute("href"), url) });
    }
  }
  return { rel, breadcrumbs };
}

// Build a Document whose section tree reflects the page's position in the docs site:
// breadcrumb ancestors wrap the page, and prev/next are ordered siblings, each with content
// when siblingBlocks supplies it.
export function compose({ url, html, title, blocks, losses = [], source, generator, siblingBlocks = {} }) {
  const nav = extractNav(html, url);

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
