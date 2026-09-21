// Navigation shell: wraps one page in a section tree built from its own navigation
// (breadcrumbs, rel=next/prev/up). Siblings are title+URL stubs with no content; this is
// not a site crawl. The tree, not the page, is the document-unit structure no extractor emits.
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
// breadcrumb ancestors wrap the page, and prev/next are empty sibling stubs.
export function compose({ url, html, title, blocks, source, generator }) {
  const nav = extractNav(html, url);

  const page = ir.section(ir.stableId(url), title || norm(extractPageTitle(html)) || url, { url });
  page.blocks = blocks;

  // Ancestor chain from breadcrumbs, wrapped around the page (topmost becomes root).
  let root = page;
  const ancestors = nav.breadcrumbs;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    const s = ir.section(ir.stableId(a.url), a.title, { url: a.url });
    s.children.push(root);
    root = s;
  }
  if (root === page && nav.rel.up) {
    const up = ir.section(ir.stableId(nav.rel.up.url), nav.rel.up.title || "Parent", { url: nav.rel.up.url });
    up.children.push(page);
    root = up;
  }

  // prev/next are siblings of the page: attach to the page's immediate parent (or root).
  const parent = root === page ? null : immediateParent(root, page.id);
  const siblingHost = parent ?? root;
  for (const k of ["prev", "next"]) {
    const r = nav.rel[k];
    if (r && r.url) {
      const stub = ir.section(ir.stableId(r.url), r.title || (k === "prev" ? "Previous" : "Next"), { url: r.url });
      if (siblingHost === root) root.children.push(stub);
      else siblingHost.children.push(stub);
    }
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
