// The share URL grammar: bareflow.1mb.dev/<target>, the target as typed or as a browser left it.
// Query and fragment belong to the target. The browser has already resolved `..` segments and
// may have collapsed `https://` to `https:/`; both are accepted as the target's.
//   { kind: "landing" }                    nothing after the origin
//   { kind: "target", url }                an http(s) URL
//   { kind: "redirect", url }              a bare host, sent on as https://
//   { kind: "error", message }             anything else; message is the sentence shown
// A first segment that ends in a file extension is a file name (this site's, served before the
// shell sees it, or a mistyped one), not a host. None of these is a top-level domain; md, zip and
// mov are, so they stay out.
const FILE = /\.(html?|php|aspx?|jsp|txt|json|xml|ico|js|css|png|jpe?g|gif|svg|webp|pdf)$/i;

export function parseShare(href, origin) {
  let s = href.startsWith(`${origin}/`) ? href.slice(origin.length + 1) : "";
  if (!s || s[0] === "?" || s[0] === "#") return { kind: "landing" };
  if (/^https?%3a/i.test(s)) {
    try { s = decodeURIComponent(s); } catch { return { kind: "error", message: "The address after bareflow.1mb.dev/ is not a valid encoded URL. Check the address." }; }
  }
  s = s.replace(/^(https?):\/(?!\/)/i, "$1://");
  // "host:8080" is a host and port, not a scheme.
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):(?!\d)/i)?.[1].toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return { kind: "error", message: `This site reads http(s) pages only, not ${scheme}: addresses. Check the address.` };
  const bare = !scheme;
  if (bare && (!/^[^/?#\s]+\.[^/?#\s]+/.test(s) || FILE.test(s.match(/^[^/?#]*/)[0]))) return { kind: "error", message: "That is not a page address. Give one like https://docs.example.com/guide." };
  let url;
  try { url = new URL(bare ? `https://${s}` : s); } catch { return { kind: "error", message: "The address after bareflow.1mb.dev/ is not a URL. Check the address." }; }
  return { kind: bare ? "redirect" : "target", url: url.href };
}
