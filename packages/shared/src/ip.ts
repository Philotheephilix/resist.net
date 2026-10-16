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

  const parts = ipv4.slice(1).map(Number)
  // Reject out-of-range octets (e.g. 192.999.1.1) — standard IPv4 requires 0-255.
  if (parts.some(n => n > 255)) return true
  const [a, b] = parts
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
 * Expand a compressed IPv6 address to its full 8-group form.
 * Handles :: abbreviation and short groups (e.g. '0::' → '0000:0000:...:0000').
 * Returns null for inputs that are not valid IPv6 notation.
 */
function expandIPv6(ip: string): string | null {
  const lower = ip.toLowerCase()
  // Must contain only hex digits, colons, and optional leading/trailing colons
  if (!/^[0-9a-f:]+$/.test(lower)) return null

  const halves = lower.split("::")
  if (halves.length > 2) return null  // multiple :: — invalid

  const pad = (groups: string[]): string[] | null => {
    // Reject groups longer than 4 hex digits — padStart only pads, never truncates,
    // so 'fe800' would survive as 'fe800' and bypass regex-based private checks.
    if (groups.some(g => g.length > 4)) return null
    return groups.map(g => g.padStart(4, "0"))
  }

  if (halves.length === 1) {
    const groups = lower.split(":")
    if (groups.length !== 8) return null
    const padded = pad(groups)
    if (!padded) return null
    return padded.join(":")
  }

  // Has :: expansion
  const left = halves[0]!.length > 0 ? halves[0]!.split(":") : []
  const right = halves[1]!.length > 0 ? halves[1]!.split(":") : []
  const missing = 8 - left.length - right.length
  if (missing < 0) return null
  const full = [...left, ...Array(missing).fill("0"), ...right]
  if (full.length !== 8) return null
  const padded = pad(full)
  if (!padded) return null
  return padded.join(":")
}

const IPV6_UNSPECIFIED = "0000:0000:0000:0000:0000:0000:0000:0000"
const IPV6_LOOPBACK    = "0000:0000:0000:0000:0000:0000:0000:0001"

/**
 * Returns true if an IPv6 address is in a private/reserved range.
 * Covers: loopback (::1), link-local (fe80::/10), ULA (fc00::/7 = fc/fd prefix),
 * IPv4-mapped (::ffff:), site-local (fec0::/10, deprecated), multicast (ff::/8).
 */
export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // Canonically expand to catch all compressed forms of loopback and unspecified
  // (e.g. '0::', '::0', '0:0::', '0:0:0:0:0:0:0::' — all expand to the same value).
  const expanded = expandIPv6(lower)
  // Treat unparseable IPv6 as private/denied — a malformed address should never
  // reach external systems (consistent with isPrivateIpv4's non-standard-form rule).
  if (expanded === null) return true
  if (expanded === IPV6_LOOPBACK || expanded === IPV6_UNSPECIFIED) return true
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
