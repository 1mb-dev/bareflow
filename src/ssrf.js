// One SSRF policy: the non-public address ranges a fetch must never reach. Shared by the dev
// fetch layer (fetch.js, which checks resolved IPs against it) and the Worker boundary
// (worker.js, which checks literal-IP hostnames against it). Keep complete: a range missing
// here is reachable in both paths.
export const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64/10
  /^192\.0\.2\./,                                    // TEST-NET-1 192.0.2.0/24
  /^198\.(18|19)\./,                                 // benchmark 198.18/15
  /^198\.51\.100\./, /^203\.0\.113\./,               // TEST-NET-2/3
  /^(22[4-9]|23[0-9])\./,                            // multicast 224/4
  /^2[4-5][0-9]\./,                                  // reserved 240/4
];

export const PRIVATE_V6 = [
  /^::1$/, /^::$/,
  /^::ffff:/i,                                       // IPv4-mapped (hex form)
  /^f[cd][0-9a-f]{2}:/i,                             // ULA fc00::/7
  /^fe[89ab][0-9a-f]:/i,                             // link-local fe80::/10
];

// IPv4-mapped and IPv4-compatible IPv6 are evaluated as their embedded IPv4 address.
function normalizeIp(ip) {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i) || ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

export function isPrivateIp(ip) {
  const n = normalizeIp(ip);
  if (n.includes(":")) return PRIVATE_V6.some((re) => re.test(n.toLowerCase()));
  return PRIVATE_V4.some((re) => re.test(n));
}
