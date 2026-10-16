/**
 * IP address utilities shared between volunteer proxy and user proxy.
 * Used for SSRF protection and SDP ICE candidate validation.
 */

/**
 * Returns true if a standard dotted-decimal IPv4 string is in a private/reserved range.
 * Rejects any non-standard form (hex, abbreviated, etc.) by returning true.
 */
export function isPrivateIpv4(ip: string): boolean {
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!ipv4) return true // non-standard form → deny

  const [, a, b] = ipv4.map(Number)
  if (a === 10) return true                              // RFC-1918 10.x
  if (a === 172 && b >= 16 && b <= 31) return true      // RFC-1918 172.16-31.x
  if (a === 192 && b === 168) return true                // RFC-1918 192.168.x
  if (a === 127) return true                             // loopback 127.x
  if (a === 169 && b === 254) return true                // link-local
  if (a === 0) return true                               // 0.x.x.x unspecified
  if (a === 100 && b >= 64 && b <= 127) return true      // RFC-6598 CGN 100.64-127.x
  if (a === 198 && (b === 18 || b === 19)) return true   // RFC-2544 benchmarking
  if (a >= 224) return true                               // multicast 224-239, reserved 240-254, broadcast 255
  return false
}

/**
 * Returns true if an IPv6 address is in a private/reserved range.
 * Covers: loopback (::1), link-local (fe80::/10), ULA (fc00::/7 = fc/fd prefix),
 * IPv4-mapped (::ffff:), site-local (fec0::/10, deprecated), multicast (ff::/8).
 */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // Loopback — compressed, single-digit expanded, and fully zero-padded forms
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1" || lower === "0000:0000:0000:0000:0000:0000:0000:0001") return true
  // Unspecified — compressed, single-digit expanded, and fully zero-padded forms
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0" || lower === "0000:0000:0000:0000:0000:0000:0000:0000") return true
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true  // fe80–febf link-local
  if (/^fe[c-f][0-9a-f]:/i.test(lower)) return true   // fec0–feff site-local (deprecated, still private)
  if (/^f[cd]/i.test(lower)) return true               // fc00::/7 ULA (fc00–fdff)
  if (/^ff/i.test(lower)) return true                  // ff00::/8 multicast
  // IPv4-mapped — both compressed (::ffff:x.x.x.x) and expanded (0:0:0:0:0:ffff:...)
  if (/^::ffff:/i.test(lower)) return true
  if (/^0:0:0:0:0:ffff:/i.test(lower)) return true
  if (/^0000:0000:0000:0000:0000:ffff:/i.test(lower)) return true
  // 6to4 (RFC 3056, deprecated by RFC 7526) — 2002::/16 embeds an IPv4 address
  // in bits 16-47. Blocking the entire prefix is the safest approach: a 2002::
  // address could tunnel to any IPv4 including RFC-1918 ranges via a 6to4 relay.
  if (/^2002:/i.test(lower)) return true
  // NAT64 well-known prefix (RFC 6052) — 64:ff9b::/96 maps to arbitrary IPv4.
  // On NAT64-enabled networks (IPv6-only mobile, corporate) this prefix routes
  // to the embedded IPv4 address, which may be an RFC-1918 internal host.
  if (/^64:ff9b:/i.test(lower)) return true
  // Teredo (RFC 4380, deprecated by RFC 7371) — 2001::/32 embeds an IPv4 server
  // address (bits 96–127, XOR'd with 0xffffffff). A crafted Teredo address can
  // encode any private IPv4 host. No legitimate use case through a circumvention proxy.
  // ORCHIDv2 (RFC 7343) — 2001:20::/28 (sub-range of 2001:: that is non-routable
  // by design) is covered by this same check as a defence-in-depth measure.
  if (/^2001:/i.test(lower)) return true
  return false
}

/**
 * Returns true if the given IP string (any family) is in a private/loopback range.
 * Handles IPv6-mapped IPv4 (::ffff:a.b.c.d) by extracting the embedded IPv4.
 */
export function isPrivateIp(ip: string): boolean {
  if (ip === "::1") return true
  if (/^fe80:/i.test(ip)) return true
  // IPv6-mapped IPv4: ::ffff:a.b.c.d
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip)
  if (mapped) return isPrivateIpv4(mapped[1]!)
  // Treat unknown ::ffff: forms as private
  if (/^::ffff:/i.test(ip)) return true
  // Full IPv6 private ranges (ULA, link-local, etc.)
  if (/^[0-9a-fA-F:]+$/.test(ip)) return isPrivateIpv6(ip)
  return isPrivateIpv4(ip)
}
