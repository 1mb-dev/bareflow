// The mdflow IR: the typed document contract. Canonical form; Markdown and JSON are renders.
//
// Block-level structure is typed (heading, paragraph, code, list, table, blockquote, image).
// Loss markers are section-level findings (section.losses), not content blocks. Inline
// formatting inside prose is retained as Markdown for v1; a full inline node tree is a later
// schema revision, not a v1 requirement.
import { createHash } from "node:crypto";

export const SCHEMA = "mdflow/ir/v1";

export const BLOCK_TYPES = new Set([
  "heading", "paragraph", "code", "list", "table", "blockquote", "image",
]);

export function stableId(str) {
  return createHash("sha256").update(String(str)).digest("hex").slice(0, 16);
}

export function heading(text, level, anchor) {
  return { type: "heading", level, text, ...(anchor ? { anchor } : {}) };
}
export function paragraph(text) {
  return { type: "paragraph", text };
}
export function code(code, lang) {
  return { type: "code", ...(lang ? { lang } : {}), code };
}
export function list(ordered, items) {
  return { type: "list", ordered, items };
}
export function table(headers, rows) {
  return { type: "table", headers, rows };
}
export function blockquote(text) {
  return { type: "blockquote", text };
}
export function image(src, alt) {
  return { type: "image", src, ...(alt ? { alt } : {}) };
}
// text: the dropped block's source text, when the finding is about one block.
export function loss(reason, source, text) {
  return { type: "loss", reason, ...(source ? { source } : {}), ...(text != null ? { text } : {}) };
}

export function section(id, title, opts = {}) {
  return { id, title, ...(opts.url ? { url: opts.url } : {}), blocks: [], losses: [], children: [] };
}

// Document is the tree root: document -> section -> block. scope says what the sections cover
// (one page, or a prev/next window onto a docs section, never the whole section); breadcrumbs
// is where the page sits in the site.
export const SCOPE_KINDS = new Set(["page", "window"]);
export const SIBLING_STATUS = new Set(["attached", "unfetched", "failed", "blocked", "absent"]);
// An attached sibling is projected: whole verbatim blocks of the kept types, never a summary.
export const PROJECTIONS = new Set(["headings+code", "full"]);

// UTF-8 bytes of the text an agent reads in these blocks: prose, code, list items, table cells,
// image alt. No keys or syntax, so the count is the same under every render. Changing what
// counts is a schema change.
const utf8 = new TextEncoder();
export function textBytes(blocks) {
  let n = 0;
  for (const b of blocks) for (const s of [b.text, b.code, b.alt, ...(b.items ?? []), ...(b.headers ?? []), ...(b.rows ?? []).flat()]) if (typeof s === "string") n += utf8.encode(s).length;
  return n;
}

export function document({ id, title, source, generator, scope, breadcrumbs, sections }) {
  return { schema: SCHEMA, id, title, source, generator, scope, breadcrumbs, sections };
}

const fail = (path, msg) => { throw new Error(`IR contract violation at ${path}: ${msg}`); };

export function validate(doc) {
  if (doc.schema !== SCHEMA) fail("schema", `expected ${SCHEMA}, got ${doc.schema}`);
  if (typeof doc.id !== "string" || !doc.id) fail("id", "missing");
  if (typeof doc.title !== "string") fail("title", "missing");
  if (!doc.source || typeof doc.source.url !== "string" || typeof doc.source.fingerprint !== "string" || typeof doc.source.retrievedAt !== "string")
    fail("source", "url, fingerprint, and retrievedAt required");
  if (!doc.generator || typeof doc.generator.version !== "string" || typeof doc.generator.extractor !== "string" || typeof doc.generator.extractorVersion !== "string")
    fail("generator", "version, extractor, and extractorVersion required");
  if (!doc.scope || !SCOPE_KINDS.has(doc.scope.kind)) fail("scope.kind", "page | window");
  for (const r of ["prev", "next"]) {
    const s = doc.scope.siblings?.[r];
    if (!s || !SIBLING_STATUS.has(s.status)) fail(`scope.siblings.${r}`, "status: attached | unfetched | failed | blocked | absent");
    if ((s.status === "absent") !== (s.url === undefined)) fail(`scope.siblings.${r}.url`, "present unless absent");
    if (s.url !== undefined && s.via !== "rel" && s.via !== "pager") fail(`scope.siblings.${r}.via`, "rel | pager, with url");
    if (s.status === "attached") {
      if (!Number.isInteger(s.text_bytes) || s.text_bytes < 0) fail(`scope.siblings.${r}.text_bytes`, "non-negative integer when attached");
      const o = s.projection?.omitted;
      if (!PROJECTIONS.has(s.projection?.mode) || !o || typeof o !== "object" || !Object.values(o).every((n) => Number.isInteger(n) && n > 0))
        fail(`scope.siblings.${r}.projection`, "{ mode: headings+code | full, omitted: { type: count } }");
    } else if (s.text_bytes !== null || s.projection !== undefined) fail(`scope.siblings.${r}`, "text_bytes null and no projection unless attached");
  }
  if (!Array.isArray(doc.breadcrumbs) || !doc.breadcrumbs.every((c) => typeof c?.url === "string" && typeof c.title === "string"))
    fail("breadcrumbs", "array of { title, url }");
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) fail("sections", "must be non-empty");
  for (const s of doc.sections) validateSection(s, "sections");
  const ids = [];
  const collect = (s) => { ids.push(s.id); s.children.forEach(collect); };
  doc.sections.forEach(collect);
  if (new Set(ids).size !== ids.length) fail("sections", "section ids must be unique");
  const attached = ["prev", "next"].some((r) => doc.scope.siblings[r].status === "attached");
  if ((doc.scope.kind === "window") !== attached) fail("scope.kind", "window exactly when a sibling is attached");
  return doc;
}

function validateSection(s, path) {
  if (typeof s.id !== "string" || !s.id) fail(`${path}.id`, "missing");
  if (typeof s.title !== "string") fail(`${path}.title`, "missing");
  if (!Array.isArray(s.blocks)) fail(`${path}.blocks`, "missing");
  for (const b of s.blocks) validateBlock(b, `${path}.blocks`);
  if (!Array.isArray(s.losses)) fail(`${path}.losses`, "missing");
  for (const l of s.losses) if (!l || typeof l.reason !== "string") fail(`${path}.losses`, "loss: reason string");
  if (!Array.isArray(s.children)) fail(`${path}.children`, "missing");
  for (const c of s.children) validateSection(c, `${path}.children`);
}

function validateBlock(b, path) {
  if (!b || typeof b.type !== "string" || !BLOCK_TYPES.has(b.type)) fail(path, `unknown block type: ${b?.type}`);
  const str = (v) => typeof v === "string";
  switch (b.type) {
    case "heading": if (!str(b.text) || !Number.isInteger(b.level) || b.level < 1 || b.level > 6) fail(path, "heading: text + integer level 1..6"); break;
    case "paragraph": if (!str(b.text)) fail(path, "paragraph: text string"); break;
    case "blockquote": if (!str(b.text)) fail(path, "blockquote: text string"); break;
    case "code": if (!str(b.code)) fail(path, "code: code string"); break;
    case "list": if (!Array.isArray(b.items) || !b.items.every(str) || typeof b.ordered !== "boolean") fail(path, "list: ordered boolean + string items"); break;
    case "table": if (!Array.isArray(b.headers) || !b.headers.every(str) || !Array.isArray(b.rows) || !b.rows.every((r) => Array.isArray(r) && r.every(str))) fail(path, "table: string headers + string rows"); break;
    case "image": if (!str(b.src)) fail(path, "image: src string"); break;
  }
}

// Flatten a document tree to a list of blocks with their section path, for render and verify.
export function* walk(doc) {
  for (const s of doc.sections) yield* walkSection(s, []);
}
function* walkSection(s, path) {
  const here = [...path, s.title];
  for (const b of s.blocks) yield { block: b, section: s, path: here };
  for (const c of s.children) yield* walkSection(c, here);
}
