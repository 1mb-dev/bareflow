// Source-loss audit: diff load-bearing blocks in the raw HTML against the extracted IR and
// emit a loss block for each one the extractor dropped. This makes silent extractor loss
// auditable, regardless of which extractor is composed. Headings only in v1: it catches
// dropped sections (the highest-signal loss) but not paragraph/code loss where headings survive.
import { parseHTML } from "linkedom";
import * as ir from "./ir.js";

const CONTAINER = ["main", "[role='main']", "article", "#content", "#main", ".content", ".document", "div.body"];
const SKIP = "nav, aside, footer, [role='navigation'], .sidebar, .toc, #toc, .sphinxsidebar";

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

// Strip a leading section number ("3.1.", "3.1.1.") so source and IR heading text compare
// even when one side drops the numbering.
function headingKey(t) {
  return t.toLowerCase().replace(/^\d+(\.\d+)*\.?\s+/, "").replace(/\s+/g, " ").trim();
}

function sourceHeadings(html) {
  const { document } = parseHTML(html);
  let container = null;
  for (const sel of CONTAINER) { container = document.querySelector(sel); if (container) break; }
  container = container ?? document.body;

  const out = [];
  for (const h of container.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    if (h.closest(SKIP)) continue;
    const text = norm(h.textContent).replace(/\s*¶\s*$/, "");
    if (text) out.push({ level: Number(h.tagName[1]), text });
  }
  return out;
}

export function auditSourceLoss(html, blocks, title = "") {
  const keys = new Set(blocks.filter((b) => b.type === "heading").map((b) => headingKey(b.text)));
  const titleKey = headingKey(title);
  const losses = [];
  for (const h of sourceHeadings(html)) {
    if (headingKey(h.text) === titleKey) continue; // the h1 that became document.title is not lost
    if (!keys.has(headingKey(h.text))) {
      losses.push(ir.loss(`source heading not extracted (h${h.level}): ${h.text}`, "source-heading-diff"));
    }
  }
  return losses;
}
