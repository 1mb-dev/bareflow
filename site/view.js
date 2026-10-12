// The result view, filled from one conversion: provenance card, loss rail, rendered page, raw
// Markdown, and the actions. app.js calls it for a live result; the contact sheet
// (scripts/contact.js) calls it for each frozen page, so both show the same view.
import { renderDoc, renderLosses } from "./render.js";

const $ = (id) => document.getElementById(id);
const REPO = "https://github.com/1mb-dev/bareflow";

// The status line for a conversion that succeeded.
export const summary = (r) => r.flattened ? "Extraction flattened this page: its structure is unreliable, see the losses."
  : `${r.losses} loss${r.losses === 1 ? "" : "es"} marked.`;

// The Markdown header's own lines, key and value, as the provenance card.
function provenance(markdown, losses) {
  const dl = $("provenance");
  dl.replaceChildren();
  for (const line of markdown.slice(4, markdown.indexOf("\n---\n")).split("\n")) {
    const at = line.indexOf(": ");
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = line.slice(0, at);
    dd.textContent = line.slice(at + 2);
    if ((dt.textContent === "losses" && losses) || dt.textContent === "warning") dd.className = "marked";
    dl.append(dt, dd);
  }
}

export function mode(source) {
  $("frame").hidden = source;
  $("rail").hidden = source || !$("rail").querySelector("li");
  $("output").hidden = !source;
  $("mode-rendered").setAttribute("aria-pressed", String(!source));
  $("mode-source").setAttribute("aria-pressed", String(source));
}

// A button says what it did for two seconds; the status line keeps the result's own message.
function said(button, text) {
  const was = button.dataset.label ??= button.textContent;
  button.textContent = text;
  clearTimeout(button.timer);
  button.timer = setTimeout(() => { button.textContent = was; }, 2000);
}

export function showView(r, url) {
  provenance(r.markdown, r.losses);
  $("frame").replaceChildren(renderDoc(r.doc, document));
  $("rail").querySelector("ol")?.remove();
  if (r.losses) {
    $("rail-head").textContent = `losses: ${r.losses}`;
    $("rail").append(renderLosses(r.doc, document));
  }
  $("output").textContent = r.markdown;
  $("view").hidden = false;
  mode(false);
  $("mode-rendered").onclick = () => mode(false);
  $("mode-source").onclick = () => mode(true);
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
