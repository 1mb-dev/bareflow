// The result view: the IR as DOM, built with createElement and textContent only. Prose fields
// are bareflow's inline Markdown (docs/ir.md "Inline text"), read as CommonMark reads it, so the
// view shows what the copied Markdown means; verify diffs this reader with marked on every frozen
// page. Page text is escaped where it would open a construct, so every unescaped `*`, `[`, `]`,
// and backtick run is bareflow's; the reader still handles any input in linear time.

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /[\t\n\f\r\p{Zs}]/u;

// Nodes sit in doubly linked lists so wrapping a run into emphasis or a link is O(1).
const list = () => ({ first: null, last: null });
function append(l, n) { n.prev = l.last; n.next = null; if (l.last) l.last.next = n; else l.first = n; l.last = n; return n; }
function unlink(l, n) { if (n.prev) n.prev.next = n.next; else l.first = n.next; if (n.next) n.next.prev = n.prev; else l.last = n.prev; }
// Move the nodes strictly between `a` and `b` (or after `a` to the end) into a new node placed after `a`.
function wrap(l, a, b, node) {
  node.c = list();
  for (let n = a.next; n && n !== b;) { const next = n.next; unlink(l, n); append(node.c, n); n = next; }
  node.prev = a; node.next = a.next; if (a.next) a.next.prev = node; else l.last = node; a.next = node;
  return node;
}

export function parseInline(s) {
  const root = list();
  const delims = list(); // `*` runs: { node, n, orig, open, close }, in order
  const brackets = []; // `[` and `![`: { node, image, active, bottom: the last `*` run before it }
  const noCloser = new Map(); // backtick run length -> position from which no closing run exists
  let text = "";
  const flush = () => { if (text) append(root, { t: "text", v: text }); text = ""; };
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === "\\" && ESCAPABLE.test(s[i + 1] ?? "")) { text += s[i + 1]; i += 2; continue; }
    if (c === "`") {
      const n = s.slice(i).match(/^`+/)[0].length;
      const end = (noCloser.get(n) ?? Infinity) <= i ? -1 : closingRun(s, i + n, n);
      if (end < 0) { noCloser.set(n, i); text += "`".repeat(n); i += n; continue; }
      let v = s.slice(i + n, end).replace(/\n/g, " ");
      if (/^ .*[^ ].* $|^ [^ ] $/s.test(v)) v = v.slice(1, -1);
      flush(); append(root, { t: "code", v }); i = end + n; continue;
    }
    if (c === "*") {
      const n = s.slice(i).match(/^\*+/)[0].length;
      const before = s[i - 1] ?? " ", after = s[i + n] ?? " ";
      const left = !SPACE.test(after) && (!PUNCT.test(after) || SPACE.test(before) || PUNCT.test(before));
      const right = !SPACE.test(before) && (!PUNCT.test(before) || SPACE.test(after) || PUNCT.test(after));
      flush(); append(delims, { node: append(root, { t: "text", v: "*".repeat(n) }), n, orig: n, open: left, close: right }); i += n; continue;
    }
    if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const image = c === "!";
      flush(); brackets.push({ node: append(root, { t: "text", v: image ? "![" : "[" }), image, active: true, bottom: delims.last }); i += image ? 2 : 1; continue;
    }
    if (c === "]") {
      const opener = brackets.pop();
      const link = opener?.active && s[i + 1] === "(" ? destination(s, i + 2) : null;
      if (!link) { text += "]"; i++; continue; }
      flush();
      emphasis(root, delims, opener.bottom);
      const node = wrap(root, opener.node, null, opener.image ? { t: "image", src: link.href } : { t: "link", href: link.href });
      unlink(root, opener.node);
      if (opener.image) { node.alt = plain(node.c); delete node.c; }
      else for (const b of brackets) b.active = false; // no link inside a link
      i = link.end; continue;
    }
    if (c === "\n") { flush(); append(root, { t: "br" }); i++; continue; }
    text += c; i++;
  }
  flush();
  emphasis(root, delims, null);
  return toArray(root);
}

// The next backtick run of exactly n at or after `from`, or -1.
function closingRun(s, from, n) {
  for (let j = s.indexOf("`", from); j >= 0; j = s.indexOf("`", j)) {
    let k = j; while (s[k] === "`") k++;
    if (k - j === n) return j;
    j = k;
  }
  return -1;
}

// An inline link destination after "](": no title (bareflow writes none), backslash escapes
// resolved, balanced parentheses, ending at ")".
function destination(s, i) {
  while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++;
  let href = "", depth = 0;
  if (s[i] === "<") return null; // bareflow escapes a leading <
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && ESCAPABLE.test(s[i + 1] ?? "")) { href += s[++i]; continue; }
    if (c === "(") depth++;
    else if (c === ")") { if (!depth) break; depth--; }
    else if (c <= " ") break;
    href += c;
  }
  while (s[i] === " " || s[i] === "\t" || s[i] === "\n") i++;
  return s[i] === ")" && !depth ? { href, end: i + 1 } : null;
}

// CommonMark's "process emphasis" for the `*` runs after `bottom` (null: all), with its rule of 3
// and openers_bottom, so a run of unmatched delimiters is passed once. The runs after `bottom`
// are consumed.
function emphasis(root, delims, bottom) {
  const floor = {};
  let closer = bottom ? bottom.next : delims.first;
  while (closer) {
    if (!closer.close) { closer = closer.next; continue; }
    const key = `${closer.open}${closer.orig % 3}`;
    const stop = floor[key] ?? bottom;
    let opener = closer.prev;
    for (; opener && opener !== stop; opener = opener.prev) {
      if (opener.open && !((opener.close || closer.open) && (opener.orig + closer.orig) % 3 === 0 && (opener.orig % 3 || closer.orig % 3))) break;
    }
    if (!opener || opener === stop) {
      floor[key] = closer.prev;
      const next = closer.next;
      if (!closer.open) unlink(delims, closer);
      closer = next;
      continue;
    }
    const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    opener.n -= use; closer.n -= use;
    opener.node.v = "*".repeat(opener.n); closer.node.v = "*".repeat(closer.n);
    wrap(root, opener.node, closer.node, { t: use === 2 ? "strong" : "em" });
    opener.next = closer; closer.prev = opener; // the runs between are inside the emphasis now
    if (!opener.n) { unlink(root, opener.node); unlink(delims, opener); }
    if (!closer.n) { const next = closer.next; unlink(root, closer.node); unlink(delims, closer); closer = next; }
  }
  if (bottom) { bottom.next = null; delims.last = bottom; } else { delims.first = delims.last = null; }
}

// Linked lists to arrays, adjacent text merged, emptied delimiter text dropped.
function toArray(l) {
  const out = [];
  for (let n = l.first; n; n = n.next) {
    if (n.t === "text") { if (!n.v) continue; if (out.at(-1)?.t === "text") out.at(-1).v += n.v; else out.push({ t: "text", v: n.v }); continue; }
    const { prev, next, c, ...rest } = n;
    out.push(c ? { ...rest, c: toArray(c) } : rest);
  }
  return out;
}

function plain(l) {
  let t = "";
  for (let n = l.first; n; n = n.next) t += n.c ? plain(n.c) : n.t === "image" ? n.alt : n.v ?? "";
  return t;
}

// A link target the view will follow: resolved against the page's own URL, http(s) or mailto
// after resolving, and never a 1mb.dev host (a click from here would carry that site's cookies).
export function safeHref(href, base) {
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (u.protocol === "mailto:") return u.href;
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  return h === "1mb.dev" || h.endsWith(".1mb.dev") ? null : u.href;
}

// The page's sections and blocks as an <article>. Every element and attribute here is a literal;
// page text arrives only through textContent and checked hrefs. No ids: page ids could clobber
// globals, so a #fragment link goes to the original page.
export function renderDoc(doc, d) {
  const base = doc.source.finalUrl || doc.source.url;
  const el = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const inline = (parent, s) => { for (const n of parseInline(s)) parent.append(node(n)); return parent; };
  // A checked href as a link, or the same content as refused text.
  const anchor = (href, ...parts) => {
    const e = href ? el("a") : el("span", "link-refused");
    if (href) { e.href = href; e.rel = "noopener noreferrer nofollow ugc"; }
    e.append(...parts);
    return e;
  };
  // inLink: inside a link an image is words, not a second link (an <a> in an <a> takes the click).
  function node(n, inLink) {
    switch (n.t) {
      case "text": return d.createTextNode(n.v);
      case "br": return el("br");
      case "code": return el("code", null, n.v);
      case "strong": case "em": { const e = el(n.t); for (const k of n.c) e.append(node(k, inLink)); return e; }
      case "link": return anchor(safeHref(n.href, base), ...n.c.map((k) => node(k, true)));
      case "image": return picture(n.alt, n.src, false, inLink);
    }
  }
  // An image is never loaded: it is a link to the image on its host (http(s) only, by safeHref),
  // named by its alt. Block: a figure, `image, <host>` over the alt. Inline: the alt, then `(image)`.
  // Unlinkable (data:, 1mb.dev, ...): the same words, not a link.
  function picture(alt, src, block, inLink) {
    const href = safeHref(src, base), web = href && /^https?:/.test(href) ? href : null;
    if (block) {
      const fig = el("figure", "image");
      fig.append(anchor(web, el("span", "image-host", web ? `image, ${new URL(web).hostname}` : "image"), ...(alt ? [el("span", "image-alt", alt)] : [])));
      return fig;
    }
    const f = d.createDocumentFragment();
    f.append(inLink ? d.createTextNode(alt || "image") : anchor(web, alt || "image"), ...(alt ? [el("span", "image-tag", " (image)")] : []));
    return f;
  }
  const article = el("article", "page");
  // Headings get ids from their text, prefixed so no page id can take one of the view's own.
  const taken = new Set();
  const heading = (e) => {
    const slug = `bf-${e.textContent.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section"}`;
    let id = slug;
    for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
    taken.add(id);
    e.id = id;
    return e;
  };
  const section = (s, depth) => {
    article.append(heading(el(`h${Math.min(depth, 6)}`, null, s.title)));
    for (const b of s.blocks) article.append(block(b));
    for (const c of s.children) section(c, depth + 1);
  };
  function block(b) {
    switch (b.type) {
      case "heading": return heading(inline(el(`h${Math.min(b.level, 6)}`), b.text));
      case "paragraph": return inline(el("p"), b.text);
      case "blockquote": return el("blockquote").appendChild(inline(el("p"), b.text)).parentNode;
      case "list": { const e = el(b.ordered ? "ol" : "ul"); for (const it of b.items) e.append(inline(el("li"), it)); return e; }
      case "code": {
        const fig = el("figure", "code");
        if (b.lang) fig.append(el("figcaption", null, b.lang));
        fig.append(el("pre").appendChild(el("code", null, b.code)).parentNode);
        return fig;
      }
      case "image": return picture(b.alt, b.src, true);
      case "table": {
        if (!b.headers.length) return d.createTextNode(""); // as the Markdown render: no table
        const t = el("table");
        const row = (cells, tag) => { const r = el("tr"); for (const c of cells) r.append(inline(el(tag), c ?? "")); return r; };
        t.append(el("thead").appendChild(row(b.headers, "th")).parentNode);
        const body = el("tbody"); for (const r of b.rows) body.append(row(r, "td")); t.append(body);
        const wrap = el("div", "table-scroll"); // scrolls a wide table in place (view.js labels it then)
        wrap.append(t);
        return wrap;
      }
      default: return d.createTextNode("");
    }
  }
  for (const s of doc.sections) section(s, 1);
  return article;
}

// The losses as a numbered list in IR order: L<n> is the n-th loss, as in the Markdown notes.
export function renderLosses(doc, d) {
  const ol = d.createElement("ol");
  ol.className = "losses";
  doc.sections.flatMap((s) => s.losses).forEach((l, i) => {
    const li = d.createElement("li");
    const head = d.createElement("p");
    const n = d.createElement("span"); n.className = "loss-n"; n.textContent = `L${i + 1}`;
    head.append(n, d.createTextNode(` ${l.reason}`));
    li.append(head);
    if (l.text != null) {
      const det = d.createElement("details");
      const sum = d.createElement("summary"); sum.textContent = "what was dropped";
      const pre = d.createElement("pre"); pre.textContent = l.text;
      det.append(sum, pre); li.append(det);
    }
    ol.append(li);
  });
  return ol;
}
