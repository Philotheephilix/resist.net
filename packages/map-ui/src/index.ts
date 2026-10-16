/**
 * Shared map utilities for resist.net — geohash decoding and marker helpers.
 * Used by apps/web/src/components/CensorshipMap.tsx.
 */

/**
 * Decode a geohash string to approximate [lat, lng] center coordinates.
 */
export function geohashToLatLng(geohash: string): [number, number] {
  const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'
  let isLon = true
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180

  for (const char of geohash.toLowerCase()) {
    const idx = BASE32.indexOf(char)
    if (idx === -1) break
    for (let bits = 4; bits >= 0; bits--) {
      const bit = (idx >> bits) & 1
      if (isLon) {
        const mid = (lonMin + lonMax) / 2
        bit ? (lonMin = mid) : (lonMax = mid)
      } else {
        const mid = (latMin + latMax) / 2
        bit ? (latMin = mid) : (latMax = mid)
      }
      isLon = !isLon
    }
  }

  return [(latMin + latMax) / 2, (lonMin + lonMax) / 2]
}

export type MarkerColor = 'warning' | 'error' | 'success'

export const BLOCK_TYPE_COLORS: Record<string, MarkerColor> = {
  dns_poisoning: 'warning',
  tcp_rst: 'error',
  http_block: 'error',
  full_unreachable: 'error',
}

export function markerColorForBlockType(blockType: string | null): MarkerColor {
  if (!blockType) return 'success'
  return BLOCK_TYPE_COLORS[blockType] ?? 'error'
}

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  dns_poisoning: 'DNS Poisoning',
  tcp_rst: 'TCP Reset',
  http_block: 'HTTP Block',
  full_unreachable: 'Unreachable',
}

export function blockTypeLabel(blockType: string | null): string {
  if (!blockType) return 'Reachable'
  return BLOCK_TYPE_LABELS[blockType] ?? blockType
}
