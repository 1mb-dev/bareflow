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
    chip.onclick = (e) => unfold(e, $("rail"));
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

// A code block or table that scrolls sideways takes keyboard focus, and a scrolling table is a
// labelled region; one that fits is neither. Measured only while the page shows: hidden, every
// block measures 0 wide. The home's example calls it too.
export function reachable(root = $("frame")) {
  if (root.closest("[hidden]")) return;
  // Every read before any write: one layout per call, not one per block.
  const blocks = [...root.querySelectorAll("pre, .table-scroll")].map((e) => [e, e.scrollWidth > e.clientWidth]);
  for (const [e, scrolls] of blocks) {
    const table = e.classList.contains("table-scroll");
    for (const [name, value] of [["tabindex", "0"], ...(table ? [["role", "region"], ["aria-label", "table"]] : [])]) {
      if (scrolls) e.setAttribute(name, value); else e.removeAttribute(name);
    }
  }
}
// A resize can flip a block's overflow and cross the margin list's breakpoint.
globalThis.addEventListener?.("resize", () => { reachable(); current(); });

// The page's h2s as a list, from four up: in the tape on a phone, in the left margin from 56rem
// (CSS shows one or the other).
let heads = []; // the page's h2s, kept for current() on every scroll
function contents() {
  heads = [...$("frame").querySelectorAll("h2")];
  for (const id of ["contents-list", "toc-list"]) {
    $(id).replaceChildren(...heads.map((h) => {
      const li = document.createElement("li"), a = document.createElement("a");
      a.href = `#${h.id}`;
      a.textContent = h.textContent;
      a.onclick = (e) => { $("contents").removeAttribute("open"); jump(e, h); };
      li.append(a);
      return li;
    }));
  }
  $("contents").dataset.shown = String(heads.length >= 4);
  marked = -2; // a new list carries no mark
}

// The margin list marks the section being read: the last h2 whose top is no more than 16px below
// the tape (more than the scroll-padding's 8px, so a heading a contents link scrolled to counts).
// Runs on every scroll: nothing while the list is not displayed, and it writes only on a change.
let marked = -2;
function current() {
  if ($("toc").hidden || !$("toc").offsetParent) return;
  const line = $("tape").getBoundingClientRect().bottom + 16;
  let at = -1;
  for (let i = 0; i < heads.length && heads[i].getBoundingClientRect().top <= line; i++) at = i;
  if (at === marked) return;
  marked = at;
  $("toc-list").querySelectorAll("a").forEach((a, i) => {
    if (i === at) a.setAttribute("aria-current", "location"); else a.removeAttribute("aria-current");
  });
}
globalThis.addEventListener?.("scroll", current, { passive: true });

// In-page links move the view and focus, never the address: the address is the share URL, and a
// fragment there becomes part of the target's (and the Markdown's source line).
function jump(event, el) {
  event.preventDefault();
  // Still a step Back undoes: an entry at the same address, pushed before the scroll so the
  // browser keeps the old position on the entry it leaves.
  history.pushState(history.state, "");
  measure(); // the tape may have just changed height (a list closed); the observer reports late
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.scrollIntoView();
  el.focus({ preventScroll: true });
}

// The colophon opens for whoever asks for it: the chip and the tape's link land inside it.
const unfold = (event, el) => { $("colophon").setAttribute("open", ""); jump(event, el); };

export function mode(source) {
  $("frame").hidden = source;
  $("contents").hidden = $("toc").hidden = source || $("contents").dataset.shown !== "true";
  $("output").hidden = !source;
  $("mode").setAttribute("aria-pressed", String(source));
  reachable();
  current();
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
  // The fingerprint as 64 bars, one per bit, under its hex; in the colophon, never the tape (a
  // picture of the hex, not a seal).
  const hex = /^[0-9a-f]{16}$/.test(r.doc.source.fingerprint ?? "") ? r.doc.source.fingerprint : "";
  $("print").hidden = !hex;
  $("print-hex").textContent = hex;
  $("bars").replaceChildren(...[...hex].flatMap((h) => [...parseInt(h, 16).toString(2).padStart(4, "0")]).map((bit) => {
    const bar = document.createElement("span");
    bar.className = bit === "1" ? "on" : "off";
    return bar;
  }));
  $("colophon").removeAttribute("open");
  tally(r);
  $("frame").replaceChildren(renderDoc(r.doc, document));
  contents();
  $("rail").querySelector("ol")?.remove();
  if (r.losses) $("rail").append(renderLosses(r.doc, document));
  $("rail").hidden = !r.losses; // in the folded colophon, so shown in both modes
  $("output").textContent = r.markdown;
  $("copy").hidden = $("about").hidden = $("fold").hidden = false;
  let kept = null;
  try { kept = localStorage.getItem(FOLD); } catch { /* no storage: the default */ }
  fold(kept ? kept === "full" : Boolean(globalThis.matchMedia?.("(min-width: 40rem)").matches));
  $("fold").onclick = () => fold($("tape-more").hidden, true);
  $("view").hidden = false;
  mode(false);
  document.fonts?.ready.then(() => { reachable(); current(); }); // a web font moves what overflows and where headings sit
  $("mode").onclick = () => mode($("mode").getAttribute("aria-pressed") !== "true");
  $("about").onclick = (e) => unfold(e, $("colophon").querySelector("summary"));
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
