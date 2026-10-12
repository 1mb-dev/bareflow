// The page: route the share URL, get the bytes from /_fetch behind Turnstile, convert in the
// worker, show the Markdown as text. Page content reaches the DOM through textContent only.
import { parseShare } from "./url.js";
import { renderDoc, renderLosses } from "./render.js";

const $ = (id) => document.getElementById(id);
const ORIGIN = location.origin;
const REPO = "https://github.com/1mb-dev/bareflow";
const ASK = "Give a page address, like https://docs.example.com/guide/install.";
const UNAVAILABLE = "Fetch is unavailable right now: paste the page's HTML on the home page, or run npx bareflow <url>.";

// For failures that arrive without a message of their own.
const NAMED = {
  token: "The bot check failed or expired. Reload the page to try again.",
  limited: "Too many requests from here. Wait a minute and reload.",
};
const sentence = (m) => m && `${m[0].toUpperCase()}${m.slice(1)}${/[.?!]$/.test(m) ? "" : "."}`;

function show(section) {
  $("landing").hidden = section !== "landing";
  $("result").hidden = section !== "result";
}

function status(text) { $("status").textContent = text; }

function fail(code, message) {
  const said = sentence(message);
  status(code === "unavailable" ? [said, UNAVAILABLE].filter(Boolean).join(" ") : said || NAMED[code]);
  $("result").classList.add("failed");
}

const worker = () => new Worker("/_app/worker.js");
const convertIn = (msg, transfer) => new Promise((resolve) => {
  const w = worker();
  w.onmessage = ({ data }) => { w.terminate(); resolve(data); };
  w.onerror = (e) => { w.terminate(); resolve({ error: "convert", message: e.message || "the converter failed to load" }); };
  w.postMessage(msg, transfer);
});

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

function mode(source) {
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

function showResult(r, url) {
  if (r.error && !r.markdown) return fail(r.error, r.message);
  if (r.error) fail(r.error, r.message); else status(r.flattened ? "Extraction flattened this page: its structure is unreliable, see the losses." : `${r.losses} loss${r.losses === 1 ? "" : "es"} marked.`);
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

// One Turnstile token per fetch; tokens are single-use.
function token() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ready = () => {
      if (window.turnstile) {
        return window.turnstile.render($("challenge"), {
          sitekey: document.body.dataset.sitekey,
          callback: (t) => { $("challenge").hidden = true; resolve(t); },
          "error-callback": () => reject(new Error("token")),
        });
      }
      if (Date.now() - start > 10000) return reject(new Error("unavailable"));
      setTimeout(ready, 100);
    };
    ready();
  });
}

async function fetchAndConvert(url) {
  const host = new URL(url).hostname;
  $("banner").textContent = `Content from ${host}, not 1mb.dev.`;
  $("original").href = url;
  $("note").hidden = false;
  status("Checking you are not a bot...");
  let t;
  try { t = await token(); } catch (e) { return fail(e.message === "token" ? "token" : "unavailable"); }
  status(`Fetching ${host}...`);
  let res;
  try { res = await fetch(`/_fetch?url=${encodeURIComponent(url)}`, { headers: { "x-turnstile-token": t } }); } catch { return fail("unavailable"); }
  if (res.status === 429) return fail("limited");
  const code = res.headers.get("x-bareflow-error");
  if (code) return fail(code, await res.text().catch(() => ""));
  // Out of Function quota, Pages serves the shell for /_fetch instead.
  if (!res.ok || res.headers.get("content-type") !== "application/octet-stream") return fail("unavailable");
  status(`Converting ${host}...`);
  let bytes;
  try { bytes = await res.arrayBuffer(); } catch { return fail("unavailable", "The page stopped arriving partway."); }
  showResult(await convertIn({ input: "edge", url, finalUrl: res.headers.get("x-final-url") || url, bytes }, [bytes]), url);
}

async function convertPasted(url, html) {
  const p = parseShare(`${ORIGIN}/${url}`, ORIGIN);
  if (p.kind !== "target" && p.kind !== "redirect") return alertIn("paste-url", p.message || ASK);
  show("result");
  $("banner").textContent = `Pasted page, asserted as ${new URL(p.url).hostname}. Nothing was fetched.`;
  $("original").href = p.url;
  status("Converting the pasted page...");
  showResult(await convertIn({ input: "paste", url: p.url, html }), p.url);
}

function alertIn(id, message) {
  const el = $(id);
  el.setCustomValidity(message);
  el.reportValidity();
  el.addEventListener("input", () => el.setCustomValidity(""), { once: true });
}

function landing() {
  show("landing");
  $("go").addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = $("target").value.trim();
    const p = parseShare(`${ORIGIN}/${typed}`, ORIGIN);
    if (p.kind === "target" || p.kind === "redirect") location.assign(`${ORIGIN}/${p.url}`);
    else alertIn("target", p.message || ASK);
  });
  $("paste-form").addEventListener("submit", (e) => {
    e.preventDefault();
    convertPasted($("paste-url").value.trim(), $("paste-html").value);
  });
  const area = $("paste-html");
  area.addEventListener("dragover", (e) => e.preventDefault());
  area.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    file.text().then((text) => { area.value = text; });
  });
}

const route = parseShare(location.href, ORIGIN);
$("pointer").hidden = true;
if (route.kind === "landing") landing();
else {
  show("result");
  if (route.kind === "error") fail("url", route.message);
  else {
    history.replaceState(null, "", `/${route.url}`);
    fetchAndConvert(route.url);
  }
}
