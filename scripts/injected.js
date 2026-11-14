// What Cloudflare appends to an HTML page of the zone directly before </body>, for a request without a
// browser's Accept (smoke's fetch sends */*): bot detection's inline script, a ray id per response. A
// browser's Accept also gets the Web Analytics beacon, in either order; smoke never sees it. Anchored there;
// a script anywhere else, or of another shape, stays in the bytes compared.
const DETECT = String.raw`<script>\(function\(\)\{[^<]*window\.__CF\$cv\$params=\{[^<]*/cdn-cgi/challenge-platform/scripts/jsd/main\.js\?ray=[^<]*\}\)\(\);</script>`;
const INJECTED = new RegExp(`(?:${DETECT})?(?=</body>\\n</html>\\n$)`);

// latin1 maps each byte to one code unit and back, so every other byte passes through unchanged.
export const lessInjected = (bytes) => Buffer.from(bytes.toString("latin1").replace(INJECTED, ""), "latin1");
