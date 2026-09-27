// Parse HTML the way a browser would where linkedom's parser (htmlparser2) does not.
// Every read of a source page goes through here, so the pipeline and the truth scorer see the
// same tree.
import { parseHTML } from "linkedom";

const SECTION = new Set(["THEAD", "TBODY", "TFOOT"]);

// A table written with optional end tags (`<th>Description<tbody><tr>...`) leaves the cell open,
// so htmlparser2 nests the next row or section inside it. The spec closes the cell (and row)
// instead: move the stray row or section, and everything after it, out beside its ancestor.
function repairTables(document) {
  for (const cell of document.querySelectorAll("th, td")) {
    const stray = [...cell.children].find((c) => c.tagName === "TR" || SECTION.has(c.tagName));
    if (!stray) continue;
    const row = cell.parentElement;
    if (row?.tagName !== "TR") continue;
    const anchor = SECTION.has(stray.tagName) && SECTION.has(row.parentElement?.tagName) ? row.parentElement : row;
    const moved = [];
    for (let n = stray; n; n = n.nextSibling) moved.push(n);
    anchor.after(...moved);
  }
}

export function parseHtml(html) {
  const window = parseHTML(html);
  repairTables(window.document);
  return window;
}
