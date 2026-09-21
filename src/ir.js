// The mdflow IR: the typed document contract. Canonical form; Markdown and JSON are renders.
//
// Block-level structure is typed (heading, paragraph, code, list, table, image, loss, ...).
// Inline formatting inside prose is retained as Markdown for v1; a full inline node tree is
// a later schema revision, not a v1 requirement.
import { createHash } from "node:crypto";

export const SCHEMA = "mdflow/ir/v1";

export const BLOCK_TYPES = new Set([
  "heading", "paragraph", "code", "list", "table", "blockquote", "image", "loss",
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
export function loss(reason, source) {
  return { type: "loss", reason, ...(source ? { source } : {}) };
}

export function section(id, title, opts = {}) {
  return { id, title, ...(opts.url ? { url: opts.url } : {}), blocks: [], children: [] };
}

// Document is the tree root: document -> section -> block.
export function document({ id, title, source, generator, sections }) {
  return { schema: SCHEMA, id, title, source, generator, sections };
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
  if (doc.generator.config === undefined) fail("generator.config", "required");
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) fail("sections", "must be non-empty");
  for (const s of doc.sections) validateSection(s, "sections");
  return doc;
}

function validateSection(s, path) {
  if (typeof s.id !== "string" || !s.id) fail(`${path}.id`, "missing");
  if (typeof s.title !== "string") fail(`${path}.title`, "missing");
  if (!Array.isArray(s.blocks)) fail(`${path}.blocks`, "missing");
  for (const b of s.blocks) validateBlock(b, `${path}.blocks`);
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
    case "loss": if (!str(b.reason)) fail(path, "loss: reason string"); break;
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
