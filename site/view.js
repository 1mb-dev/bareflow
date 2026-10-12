// The result view, filled from one conversion: the tape (origin, loss count, copy, contents), the
// rendered page or raw Markdown, and the colophon, folded (header, losses, actions). app.js calls it
// for a live result; the contact sheet (scripts/contact.js) calls it for each frozen page, so both
// show the same view.
import { renderDoc, renderLosses } from "./render.js";

const $ = (id) => document.getElementById(id);
const REPO = "https://github.com/1mb-dev/bareflow";
const FOLD = "bareflow.tape"; // localStorage: "full" or "rolled", the reader's own choice

// The page scrolls focus and anchors clear of the sticky tape, at whatever height it has: measured
// on each change of the tape's own, and by the observer when the width rewraps it (an observer
// alone does not run in a hidden tab).
function measure() {
  document.documentElement.style.setProperty("--tape-h", `${$("tape").getBoundingClientRect().height}px`);
  $("origin").scrollLeft = $("origin").scrollWidth;
}
if (globalThis.ResizeObserver) new ResizeObserver(measure).observe($("tape"));

// Where the page came from, before anything is fetched, on the tape's line 2. Only the host
// scrolls, and it shows its end: the registrable domain is the rightmost part (a lookalike
// `docs.python.org.evil.example` must not read as `docs.python.org`).
export function origin(url, pasted) {
  $("origin-pre").textContent = pasted ? "pasted, asserted as " : "from ";
  $("origin").textContent = new URL(url).hostname;
  $("origin-post").textContent = ", not 1mb.dev";
  $("from").hidden = false;
  measure();
}

// The tape's word on the result: the loss count (the only hue), or that none is marked.
function tally(r) {
  const s = $("status");
  s.replaceChildren();
  if (r.losses) {
    const chip = document.createElement("a");
    chip.className = "chip";
    chip.href = "#rail";
    chip.textContent = `${r.losses} loss${r.losses === 1 ? "" : "es"}`;
    chip.onclick = unfold;
    s.append(chip);
  }
  if (r.flattened) s.append(`${r.losses ? " " : ""}structure unreliable`);
  if (!r.losses && !r.flattened) s.append("no losses marked");
}

// Rolled, the tape keeps the wordmark, the origin, and the count; it never hides them.
function fold(full, keep) {
  $("tape-more").hidden = !full;
  $("fold").textContent = full ? "less" : "more";
  $("fold").setAttribute("aria-expanded", String(full));
  if (keep) try { localStorage.setItem(FOLD, full ? "full" : "rolled"); } catch { /* the choice lasts this page */ }
  measure();
}

// The page's h2s as a list in the tape, from four up.
function contents() {
  const list = $("contents-list"), heads = [...$("frame").querySelectorAll("h2")];
  list.replaceChildren();
  for (const h of heads) {
    const li = document.createElement("li"), a = document.createElement("a");
    a.href = `#${h.id}`;
    a.textContent = h.textContent;
    a.onclick = () => { $("contents").removeAttribute("open"); };
    li.append(a);
    list.append(li);
  }
  $("contents").dataset.shown = String(heads.length >= 4);
}

// The colophon opens for whoever asks for it: the chip and the tape's link land inside it.
const unfold = () => { $("colophon").setAttribute("open", ""); };

export function mode(source) {
  $("frame").hidden = source;
  $("contents").hidden = source || $("contents").dataset.shown !== "true";
  $("rail").hidden = source || !$("rail").querySelector("li");
  $("output").hidden = !source;
  $("mode").setAttribute("aria-pressed", String(source));
}

// A button says what it did for two seconds; the status line keeps the result's own message.
function said(button, text) {
  const was = button.dataset.label ??= button.textContent;
  button.textContent = text;
  clearTimeout(button.timer);
  button.timer = setTimeout(() => { button.textContent = was; }, 2000);
}

export function showView(r, url) {
  $("header").textContent = r.markdown.slice(4, r.markdown.indexOf("\n---\n"));
  $("colophon").removeAttribute("open");
  tally(r);
  $("frame").replaceChildren(renderDoc(r.doc, document));
  contents();
  $("rail").querySelector("ol")?.remove();
  if (r.losses) $("rail").append(renderLosses(r.doc, document));
  $("output").textContent = r.markdown;
  $("copy").hidden = $("about").hidden = $("fold").hidden = false;
  let kept = null;
  try { kept = localStorage.getItem(FOLD); } catch { /* no storage: the default */ }
  fold(kept ? kept === "full" : Boolean(globalThis.matchMedia?.("(min-width: 40rem)").matches));
  $("fold").onclick = () => fold($("tape-more").hidden, true);
  $("view").hidden = false;
  mode(false);
  $("mode").onclick = () => mode($("mode").getAttribute("aria-pressed") !== "true");
  $("about").onclick = unfold;
  $("copy").onclick = () => navigator.clipboard.writeText(r.markdown).then(() => said($("copy"), "copied"), () => said($("copy"), "copy failed: use markdown, select all"));
  $("download").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown;charset=utf-8" }));
    a.download = `${new URL(url).hostname}${new URL(url).pathname.replace(/\/+$/, "").replace(/[^a-zA-Z0-9.-]+/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const header = r.markdown.split("\n---\n")[0];
  const report = new URL(`${REPO}/issues/new`);
  report.searchParams.set("title", `Wrong output: ${new URL(url).hostname}`);
  report.searchParams.set("body", `URL: ${url}\n(remove any tokens or private query values from the URL above)\n\nHeader:\n\`\`\`\n${header}\n---\n\`\`\`\n\nWhat is wrong:\n`);
  $("report").href = report.href;
}
