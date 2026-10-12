// The share URL grammar: bareflow.1mb.dev/<target>, the target as typed or as a browser left it.
// Query and fragment belong to the target. The browser has already resolved `..` segments and
// may have collapsed `https://` to `https:/`; both are accepted as the target's.
//   { kind: "landing" }                    nothing after the origin
//   { kind: "target", url }                an http(s) URL
//   { kind: "redirect", url }              a bare host, sent on as https://
//   { kind: "error", message }             anything else
export function parseShare(href, origin) {
  let s = href.startsWith(`${origin}/`) ? href.slice(origin.length + 1) : "";
  if (!s || s[0] === "?" || s[0] === "#") return { kind: "landing" };
  if (/^https?%3a/i.test(s)) {
    try { s = decodeURIComponent(s); } catch { return { kind: "error", message: "the address after bareflow.1mb.dev/ is not a valid encoded URL" }; }
  }
  s = s.replace(/^(https?):\/(?!\/)/i, "$1://");
  // "host:8080" is a host and port, not a scheme.
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { kind: "error", message: `bareflow reads http(s) pages only, not ${scheme}:` };
  const bare = !scheme;
  if (bare && !/^[^/?#\s]+\.[^/?#\s]+/.test(s)) return { kind: "error", message: "give a page address, like bareflow.1mb.dev/https://example.com/docs" };
  let url;
  try { url = new URL(bare ? `https://${s}` : s); } catch { return { kind: "error", message: "the address after bareflow.1mb.dev/ is not a URL" }; }
  return { kind: bare ? "redirect" : "target", url: url.href };
}
