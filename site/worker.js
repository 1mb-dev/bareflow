// The page's Web Worker: scripts/site.js prepends the verified bundle (global `bareflow`), so the
// conversion here is the one verify diffs with the CLI. One message in, one out:
//   { input: "edge", url, finalUrl, bytes }  bytes from /_fetch (ArrayBuffer)
//   { input: "paste", url, html }            a page a person gave; url is their assertion
// -> { markdown, doc, losses, flattened } or { error, message } with error one of not-html,
//    over-cap, empty (with markdown and doc), convert. `doc` is the IR the result view renders.
/* global bareflow */
const fail = (error, message, extra) => ({ error, message, ...extra });

async function work(m) {
  let args;
  if (m.input === "edge") {
    const body = new Uint8Array(m.bytes);
    if (body.subarray(0, 1024).includes(0)) return fail("not-html", "the address returned a binary file, not an HTML page");
    const s = bareflow.snapshot({ finalUrl: m.finalUrl, body });
    args = { url: m.url, finalUrl: s.finalUrl, html: s.html, retrievedAt: s.retrievedAt, fingerprint: s.fingerprint, input: "edge" };
  } else {
    if (new TextEncoder().encode(m.html).length > bareflow.MAX_BYTES) return fail("over-cap", `the pasted page is over ${bareflow.MAX_BYTES / 1048576} MB`);
    args = { url: m.url, html: m.html, retrievedAt: new Date().toISOString(), input: "paste" };
  }
  const { doc, markdown } = await bareflow.convert(args);
  const count = (s) => s.blocks.length + s.children.reduce((n, c) => n + count(c), 0);
  if (!doc.sections.reduce((n, s) => n + count(s), 0)) return fail("empty", "the page has no readable content; sites that render with JavaScript come back empty", { markdown, doc });
  // Loss count and flattening as the header states them (the golden surface pins its fields).
  const header = markdown.slice(0, markdown.indexOf("\n---\n"));
  return { markdown, doc, losses: Number(header.match(/^losses: (\d+)$/m)[1]), flattened: /^warning: /m.test(header) };
}

self.onmessage = async ({ data }) => {
  try { self.postMessage(await work(data)); } catch (e) { self.postMessage(fail("convert", String(e?.message || e))); }
};
