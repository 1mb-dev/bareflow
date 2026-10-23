// Cloudflare's always-pass Turnstile test sitekey: a build that carries it is for local use only.
export const TEST_SITEKEY = "1x00000000000000000000AA";
// Every published test sitekey (pass, fail, invisible pass and fail, interactive): none is a deploy's.
export const TEST_SITEKEYS = new Set([TEST_SITEKEY, "2x00000000000000000000AB", "1x00000000000000000000BB", "2x00000000000000000000BB", "3x00000000000000000000FF"]);

// The key a deploy builds with: unset or a test key is refused before anything is built.
export function deployKey(key) {
  const k = String(key ?? "").trim();
  if (!k) throw new Error("TURNSTILE_SITEKEY unset: a deploy builds with the widget's real sitekey");
  if (TEST_SITEKEYS.has(k)) throw new Error(`TURNSTILE_SITEKEY is Cloudflare's test key ${k}: a deploy builds with the widget's real sitekey`);
  return k;
}
