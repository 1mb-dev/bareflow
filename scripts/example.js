// The home's example: a frozen docs page through the real pipeline and the view's own renderers
// (site/render.js), as static HTML for scripts/site.js to splice into the home. The page is Vue's
// "Computed Properties" (CC BY 4.0; NOTICE): its first example, where bareflow kept one code
// block's last lines and marked the block as L1. Everything shown comes from the IR; if the IR
// moves under the excerpt, the build fails rather than show another page's meaning.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { run } from "../src/pipeline.js";
import { renderDoc, renderLosses } from "../site/render.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EXAMPLE = { fixture: "test/fixtures/vitepress-vue-computed.html", url: "https://vuejs.org/guide/essentials/computed.html" };
export const LICENSE = "https://creativecommons.org/licenses/by/4.0/";
const FIXED = "2026-01-01T00:00:00.000Z";
const flat = (t) => t.replace(/\s+/g, " ").trim();

// The IR and the excerpt of it the home shows: blocks 2-5 of the one section (the first heading,
// its paragraph, the Options API code, and the remains of the Composition API code that L1 marks).
// One run per process: the build and verify ask for it several times. Callers only read it.
let once;
export const excerpt = () => (once ??= cut());
async function cut() {
  const { doc } = await run({ url: EXAMPLE.url, html: await readFile(join(ROOT, EXAMPLE.fixture), "utf8"), retrievedAt: FIXED });
  const [s] = doc.sections, b = s.blocks, skipped = b.slice(0, 2), shown = b.slice(2, 6);
  const fits = doc.sections.length === 1 && !s.children.length && s.losses.length === 2 &&
    skipped.every((k) => k.type === "paragraph" && /^\[Watch a free video lesson on Vue School\]\(https:\/\/vueschool\.io\/[^)]+\)$/.test(k.text)) &&
    shown.map((k) => k.type).join() === "heading,paragraph,code,code" &&
    flat(s.losses[0].text).includes(flat(shown[3].code)) && flat(s.losses[0].text) !== flat(shown[3].code);
  if (!fits) throw new Error(`${EXAMPLE.fixture}: the IR no longer has the excerpt the home shows (blocks 2-5, L1's remains); choose it again`);
  return { doc, part: { ...doc, sections: [{ ...s, blocks: shown }] }, skipped: skipped.length };
}

// The example as an element of document d: a heading and a figure holding a still tape, the
// excerpt, the losses with L1 open, and the attribution; bareflow says nothing inside the page's
// area but the elisions. No ids (a paste renders a page into the
// same document), no controls.
export async function example(d) {
  const { doc, part, skipped } = await excerpt();
  const el = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const link = (href, text) => { const a = el("a", null, text); a.href = href; return a; };
  const losses = doc.sections[0].losses.length;
  const host = new URL(doc.source.url).hostname;

  const tape = el("div", "exhibit-tape");
  const line = el("p", "tape-line");
  line.append(el("span", "name", "bareflow"), " ", el("span", "chip", `${losses} loss${losses === 1 ? "" : "es"}`));
  tape.append(line, el("p", "tape-from", `from ${host}, not 1mb.dev`));

  const article = renderDoc(part, d);
  for (const h of article.querySelectorAll("[id]")) h.removeAttribute("id");
  article.firstElementChild.after(el("p", "elision", `not shown here: ${skipped} links to Vue School lessons`));
  const end = el("p", "elision", "not shown here: the rest of the page. ");
  end.append(link(`/${doc.source.url}`, "Convert it now"));
  article.append(end);

  const lost = renderLosses(doc, d);
  lost.querySelector("details").setAttribute("open", "");

  const credit = el("figcaption");
  credit.append(link(doc.source.url, `"${doc.title}"`), " (c) 2019-present Yuxi (Evan) You and Vue documentation contributors. ",
    link(LICENSE, "CC BY 4.0"), ". Excerpt, converted by bareflow; changes marked above.");

  const figure = el("figure", "exhibit");
  for (const partEl of [tape, article, lost]) {
    const row = el("div", "exhibit-part");
    row.append(partEl);
    figure.append(row);
  }
  figure.append(credit);
  const section = el("section", "example");
  section.append(el("h2", null, "example"), figure);
  return section;
}

// The example as HTML, for the home.
export async function exampleHtml() {
  const { document } = parseHTML("<!doctype html><html><body></body></html>");
  return (await example(document)).outerHTML;
}
