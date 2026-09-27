// The plain-text arm: a page as an agent's fetch tool would hand it over. Shared by both usage
// gates so the arm is byte-identical between them.
import { parseHTML } from "linkedom";

// Block elements end a line; pre keeps its text; script, style and hidden content are dropped.
const BLOCK = new Set(["P", "DIV", "LI", "TR", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "ASIDE", "MAIN", "BLOCKQUOTE", "DT", "DD", "TABLE", "UL", "OL", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY", "BR", "HR"]);
const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);
export function plainText(html) {
  const { document } = parseHTML(html);
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(n.textContent.replace(/\s+/g, " ")); return; }
    if (n.nodeType !== 1 || DROP.has(n.tagName)) return;
    if (n.tagName === "PRE") { out.push("\n", n.textContent, "\n"); return; }
    if (n.tagName === "TD" || n.tagName === "TH") out.push(" | ");
    for (const c of n.childNodes) walk(c);
    if (BLOCK.has(n.tagName)) out.push("\n");
  };
  walk(document.documentElement);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
