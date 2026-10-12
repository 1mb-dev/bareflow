// Markdown syntax bareflow writes around page text: one place for the rules both the IR (inline
// Markdown, see ir.js) and the render depend on.

const longestRun = (t) => Math.max(0, ...(t.match(/`+/g) ?? []).map((r) => r.length));

// Inline code delimited by a backtick run longer than any inside it, padded when it starts or
// ends with one (CommonMark code spans): `` ``` `` stays code, not a fence.
export function codeSpan(t) {
  const d = "`".repeat(longestRun(t) + 1);
  const pad = /^`|`$/.test(t) ? " " : "";
  return `${d}${pad}${t}${pad}${d}`;
}

// A fenced block one backtick longer than any run inside the text, so the text cannot close it.
export function fenced(text, lang = "") {
  const f = "`".repeat(Math.max(3, longestRun(text) + 1));
  return `${f}${lang}\n${text}\n${f}`;
}

const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const ALNUM = /[A-Za-z0-9]/;

// Page text inside inline Markdown, escaped where it would open or close a construct, and only
// there (escapes cost bytes against the cost bar). One pass, linear. At the end of a run bareflow's
// own syntax may follow, so \ < & ! are escaped there too.
export function escapeText(t, { cell = false } = {}) {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i], prev = t[i - 1] ?? "", next = t[i + 1] ?? "";
    if (c === "\\") out += !next || PUNCT.includes(next) ? "\\\\" : "\\";
    else if ("`*[]~".includes(c)) out += "\\" + c;
    else if (c === "_") out += ALNUM.test(prev) && ALNUM.test(next) ? "_" : "\\_";
    else if (c === "<") out += !next || /[A-Za-z/!?]/.test(next) ? "\\<" : "<";
    else if (c === "&") out += !next || /^#?[A-Za-z0-9]+;/.test(t.slice(i + 1, i + 34)) ? "\\&" : "&";
    else if (c === "!" && !next) out += "\\!"; // before bareflow's [ it would make a link an image
    else if (c === "|" && cell) out += "\\|";
    else out += c;
  }
  return out;
}

// A prose field's first characters, where a line start could open a block: an ATX heading, a
// quote, a list item, an ordered-list delimiter. bareflow writes none of these at a field start.
export const escapeStart = (t) => t.replace(/^([#>+-])/, "\\$1").replace(/^(\d{1,9})([.)])/, "$1\\$2");

// A heading's closing "#" run would be eaten as the ATX closing sequence ("C #" renders "C").
export const escapeHeadingEnd = (t) => t.replace(/(^|\s)(#+)\s*$/, "$1\\$2");

// A link or image destination: whitespace percent-encoded, ( ) \ and a leading < escaped, and
// an & before an entity-like run escaped (renderers decode "javascript&colon;" otherwise), so the
// URL is unchanged but cannot close the destination early, open another construct, or decode.
export const dest = (u) => u.replace(/\s/g, (c) => encodeURIComponent(c)).replace(/[()\\]/g, "\\$&").replace(/^</, "\\<")
  .replace(/&(?=#?[A-Za-z0-9]{1,32};)/g, "\\&");

// Markdown backslash escapes removed, for comparing IR text with source text. A code span is
// literal (a backslash in `C:\` or `\d` is page text), so it is copied as is; an escaped backtick
// opens no span.
export function unescape(t) {
  let out = "";
  for (let i = 0; i < t.length;) {
    if (t[i] === "\\" && /[!-/:-@[-`{-~]/.test(t[i + 1] ?? "")) { out += t[i + 1]; i += 2; continue; }
    if (t[i] === "`") {
      const run = t.slice(i).match(/^`+/)[0];
      const close = t.slice(i + run.length).match(new RegExp(`(?<!\`)${run}(?!\`)`));
      const end = close ? i + run.length + close.index + run.length : i + run.length;
      out += t.slice(i, end); i = end; continue;
    }
    out += t[i++];
  }
  return out;
}
