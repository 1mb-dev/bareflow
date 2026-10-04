// Use log for the dogfood (MLP v1 P5): one JSON line per CLI use, appended to $MDFLOW_LOG when
// it is set, nothing otherwise. A log write that fails is reported and never fails the fetch.
import { appendFileSync } from "node:fs";

export const USE_KEYS = ["day", "url", "host", "format", "bytes", "losses", "flattened"];
export const ERROR_KEYS = ["day", "url", "host", "error"];

const hostOf = (url) => { try { return new URL(url).host; } catch { return ""; } };

export function useEntry({ url, format, output, doc, error, at = new Date() }) {
  const day = at.toISOString().slice(0, 10);
  if (error) return { day, url, host: hostOf(url), error: String(error?.message || error) };
  const losses = doc.sections.flatMap((s) => s.losses);
  return { day, url, host: hostOf(url), format, bytes: Buffer.byteLength(output, "utf8"), losses: losses.length, flattened: losses.some((l) => l.source === "extract-flattened") };
}

export function logUse(path, entry) {
  if (!path) return;
  try { appendFileSync(path, JSON.stringify(entry) + "\n"); }
  catch (e) { console.error(`mdflow: use log not written to ${path}: ${e.message}`); }
}
