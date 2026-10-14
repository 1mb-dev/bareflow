// The page: route the share URL, get the bytes from /_fetch behind Turnstile, convert in the
// worker, show the result (view.js). Page content reaches the DOM through textContent only.
import { parseShare } from "./url.js";
import { origin, reachable, showView } from "./view.js";

const $ = (id) => document.getElementById(id);
const ORIGIN = location.origin;
const ASK = "Give a page address, like https://docs.example.com/guide/install.";
const SLOW = 10000; // ms to wait for the bot check's widget
const CONVERT_TIMEOUT = 20000; // ms for one conversion; equals src/fetch-policy.js CONVERT_TIMEOUT

// What a failure says (docs/voice.md): what happened, then what to do. Each entry gives
// [what happened, the next step, the next step where the home shows the paste form (from 40rem,
// style.css .desktop)]; a phone is never told to paste. h is the host, n the upstream HTTP status.
const CHECK = "Check the address.", LATER = "Try again later.", RELOAD = "Reload the page to try again.";
const CHECK_OR_PASTE = "Check the address, or save the page and paste its HTML on the home page.";
const LATER_OR_PASTE = "Try again later, or save the page and paste its HTML on the home page.";
const SAVE_AND_PASTE = "Save it from your browser and paste its HTML on the home page.";
const OR_PASTE = "Or paste the page's HTML on the home page.";
const original = (h) => `Open the original at ${h}.`;
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
// The subject of a sentence about the host that answered: hop, when a redirect led away from h.
const via = (h, hop) => (hop && hop !== h ? `${h} redirects to ${hop}, which` : h);
const SAY = {
  url: () => ["This site does not fetch that address.", CHECK],
  blocked: (h) => [`${h} is, or leads to, a private network address; this site fetches public addresses only.`, CHECK],
  timeout: (h, _, __, hop) => [`${via(h, hop)} did not answer within 30 seconds.`, LATER, LATER_OR_PASTE],
  upstream: (h, n, _, hop) => {
    if (!n) return [`This site could not read the page from ${h}.`, original(h), SAVE_AND_PASTE];
    const who = via(h, hop);
    if (n === 401 || n === 403) return [`${who} refused the request (HTTP ${n}).`, CHECK, CHECK_OR_PASTE];
    if (n === 404 || n === 410) return [`${who} has no page at that address (HTTP ${n}).`, CHECK];
    if (n === 429) return [`${who} is limiting requests (HTTP 429).`, LATER, LATER_OR_PASTE];
    if (n >= 500) return [`${who} could not serve the page (HTTP ${n}).`, LATER, LATER_OR_PASTE];
    return [`${who} answered HTTP ${n}, not the page.`, CHECK, CHECK_OR_PASTE];
  },
  redirect: (h) => [`${h} redirects to an address this site does not fetch.`, original(h), SAVE_AND_PASTE],
  "over-cap": (h, _, pasted) => (pasted
    ? ["The pasted HTML is over 5 MB, this site's limit for a paste.", original(h)]
    : [`${h}'s page is over 1 MB, this site's limit for a fetched page.`, original(h), "Save it and paste its HTML on the home page (up to 5 MB)."]),
  token: () => ["The bot check failed or expired.", RELOAD],
  "check-timeout": () => ["The bot check timed out before it was answered.", RELOAD],
  challenge: () => ["The bot check did not load from challenges.cloudflare.com.", "If a content blocker is on, allow that address, then reload.", `If a content blocker is on, allow that address, then reload. ${OR_PASTE}`],
  "check-slow": () => [`The bot check did not load from challenges.cloudflare.com within ${SLOW / 1000} seconds; the network may be slow, or a content blocker may be stopping it.`, RELOAD, `${RELOAD} ${OR_PASTE}`],
  limited: () => ["This site has had too many requests from your network.", "Wait a minute, then reload."],
  unavailable: () => ["Fetching is unavailable right now.", LATER, `${LATER} ${OR_PASTE}`],
  cut: (h) => [`${h}'s page stopped arriving partway.`, RELOAD],
  "not-html": (h, _, pasted) => [pasted ? "The pasted text is not an HTML page." : `${h} did not return an HTML page.`, original(h)],
  blank: (h, _, pasted) => [pasted ? "The pasted HTML is an empty page." : `${h}'s page is empty.`, original(h)],
  "too-deep": (h, _, pasted) => [pasted ? "The pasted page nests too deeply for this site to read." : `${h}'s page nests too deeply for this site to read.`, original(h)],
  "too-big": (h, _, pasted) => [pasted ? "The pasted page has too many elements for this site to read." : `${h}'s page has too many elements for this site to read.`, original(h)],
  slow: (h, _, pasted) => [pasted ? "The pasted page took too long to convert here." : `${h}'s page took too long to convert here.`, original(h)],
  empty: (h, _, pasted) => [pasted
    ? "No readable text in the pasted HTML: a page that builds itself with JavaScript has no text in its source."
    : `No readable text came back from ${h}: a page that builds itself with JavaScript arrives empty.`, original(h)],
  convert: (h) => [`bareflow could not convert ${h}'s page; the fault is bareflow's, not the page's.`, original(h)],
  converter: () => ["The converter did not load.", RELOAD],
};
// Codes that cover causes the sentence cannot name: the server's words show beneath, capped.
const DETAIL = new Set(["url", "redirect", "upstream", "convert"]);
const CAP = 120;

// #status is the live region inside #result: a write in the task that unhides #result can go
// unannounced, so writes wait for the task after show().
let fresh = false, pending = null;
function show(section) {
  $("landing").hidden = section !== "landing";
  $("result").hidden = section !== "result";
  fresh = true;
  setTimeout(() => { fresh = false; if (pending) write(...pending); pending = null; });
}

function write(text, detail) {
  const el = $("status");
  el.textContent = text;
  if (detail) {
    const d = document.createElement("span");
    d.className = "detail";
    d.textContent = `detail: ${detail.length > CAP ? `${detail.slice(0, CAP - 3)}...` : detail}`;
    el.append(d);
  }
}

function status(text, detail) { if (fresh) pending = [text, detail]; else write(text, detail); }

// An unknown code says what unavailable says. `said` is a sentence already in voice (url.js).
function fail(code, { host, n, hop, detail, pasted, said } = {}) {
  if (!said && !Object.hasOwn(SAY, code)) code = "unavailable";
  const [what, next, wide] = said ? [said] : SAY[code](host, n, pasted, hop);
  const desktop = wide && globalThis.matchMedia?.("(min-width: 40rem)").matches;
  const shown = DETAIL.has(code) && !(code === "upstream" && n) ? detail : "";
  status([what, desktop ? wide : next].filter(Boolean).join(" "), shown);
  $("result").dataset.failed = code;
}

const worker = () => new Worker("/_app/worker.js");
// A conversion is synchronous work in the worker; only terminating the worker stops one that runs on.
// The deadline starts when the worker says it has begun, so loading the bundle does not count.
const convertIn = (msg, transfer) => new Promise((resolve) => {
  const w = worker();
  let timer;
  const done = (r) => { clearTimeout(timer); w.terminate(); resolve(r); };
  w.onmessage = ({ data }) => (data?.started ? (timer = setTimeout(() => done({ error: "slow" }), CONVERT_TIMEOUT)) : done(data));
  // worker.js answers every message, errors included: onerror is the script failing to load.
  w.onerror = () => done({ error: "converter" });
  w.postMessage(msg, transfer);
});

function showResult(r, url, pasted) {
  const said = { host: new URL(url).hostname, detail: r.message, pasted };
  // The view writes the tally itself; a progress line still waiting would overwrite it.
  fresh = false;
  pending = null;
  if (r.error && !r.markdown) return fail(r.error, said);
  showView(r, url);
  if (r.error) fail(r.error, said);
}

// Turnstile's script loads only to fetch a page: the home and a paste make no third-party request.
let blocked = false;
function loadTurnstile() {
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.onerror = () => { blocked = true; };
  document.head.append(s);
}

// Turnstile's error codes (its client-side error-codes page): a sitekey or domain fault is this
// site's; an iframe that could not load is a blocked check; a timed-out challenge times out; the
// rest (300*, 600*, a wrong clock) failed the check.
const SITE_FAULT = new Set(["110100", "110110", "110200", "400020", "400021", "400070"]);
function widgetError(code) {
  const c = String(code);
  if (SITE_FAULT.has(c)) return "unavailable";
  if (c === "200500") return "challenge";
  if (c === "110600" || c === "110620") return "check-timeout";
  return "token";
}

// One Turnstile token per fetch; tokens are single-use.
function token() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const ready = () => {
      if (blocked) return reject(new Error("challenge"));
      if (window.turnstile) {
        // ready() also runs from a timer, where a throw would escape the promise. A widget that
        // will not render is this site's fault (its sitekey), not the visitor's.
        try {
          window.turnstile.render($("challenge"), {
            sitekey: document.body.dataset.sitekey,
            callback: (t) => { $("challenge").hidden = true; resolve(t); },
            // The status says reload: Turnstile's own retry and refresh would put a live widget
            // under it whose answer nothing waits for.
            retry: "never",
            "refresh-timeout": "never",
            "error-callback": (code) => { $("challenge").hidden = true; reject(new Error(widgetError(code))); },
            "timeout-callback": () => { $("challenge").hidden = true; reject(new Error("check-timeout")); },
          });
        } catch { reject(new Error("unavailable")); }
        return;
      }
      // A blocked script fails its load (challenge); no widget yet may only be a slow network.
      if (Date.now() - start > SLOW) return reject(new Error("check-slow"));
      setTimeout(ready, 100);
    };
    ready();
  });
}

async function fetchAndConvert(url) {
  loadTurnstile();
  const host = new URL(url).hostname;
  origin(url);
  $("original").href = url;
  $("note").hidden = false;
  status("Checking you are not a bot...");
  let t;
  try { t = await token(); } catch (e) { return fail(e.message); }
  status(`Fetching ${host}...`);
  let res;
  try { res = await fetch(`/_fetch?url=${encodeURIComponent(url)}`, { headers: { "x-turnstile-token": t } }); } catch { return fail("unavailable"); }
  if (res.status === 429) return fail("limited");
  const code = res.headers.get("x-bareflow-error");
  if (code) return fail(code, { host, n: Number(res.headers.get("x-bareflow-status")) || 0, hop: hostOf(res.headers.get("x-final-url")), detail: await res.text().catch(() => "") });
  // Out of Function quota, Pages serves the shell for /_fetch instead.
  if (!res.ok || res.headers.get("content-type") !== "application/octet-stream") return fail("unavailable");
  status(`Converting ${host}...`);
  let bytes;
  try { bytes = await res.arrayBuffer(); } catch { return fail("cut", { host }); }
  showResult(await convertIn({ input: "edge", url, finalUrl: res.headers.get("x-final-url") || url, bytes }, [bytes]), url);
}

async function convertPasted(url, html) {
  const p = parseShare(`${ORIGIN}/${url}`, ORIGIN);
  if (p.kind !== "target" && p.kind !== "redirect") return alertIn("paste-url", p.message || ASK);
  show("result");
  origin(p.url, true);
  $("original").href = p.url;
  status("Converting the pasted page...");
  showResult(await convertIn({ input: "paste", url: p.url, html }), p.url, true);
}

function alertIn(id, message) {
  const el = $(id);
  el.setCustomValidity(message);
  el.reportValidity();
  el.addEventListener("input", () => el.setCustomValidity(""), { once: true });
}

function landing() {
  show("landing");
  // The example's code is pre-rendered; a block that scrolls at this width takes focus, as in the view.
  const example = document.querySelector(".exhibit");
  if (example) {
    const check = () => reachable(example);
    check();
    globalThis.addEventListener?.("resize", check);
    document.fonts?.ready.then(check);
  }
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
  if (route.kind === "error") fail("url", { said: route.message });
  else {
    history.replaceState(null, "", `/${route.url}`);
    fetchAndConvert(route.url);
  }
}
