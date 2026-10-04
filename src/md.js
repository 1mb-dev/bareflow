// Markdown syntax mdflow writes around page text: one place for the rules both the IR (inline
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
