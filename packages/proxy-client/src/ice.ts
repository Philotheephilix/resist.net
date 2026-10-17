/**
 * ICE configuration builder.
 *
 * Preferred: fetchIceConfig(baseUrl) — fetches short-lived Cloudflare TURN
 * credentials from /api/turn-credentials on the resist.net backend.
 * All traffic is relayed; neither peer exposes its own IP or port.
 *
 * Fallback: buildIceConfig() — reads static TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL
 * env vars. If none set, falls back to STUN-only (direct P2P).
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
]

export interface IceConfig {
  iceServers: RTCIceServer[]
  iceTransportPolicy?: RTCIceTransportPolicy
}

/**
 * Fetch short-lived TURN credentials from the resist.net backend.
 * Returns relay-only config on success; falls back to buildIceConfig() on error.
 */
export async function fetchIceConfig(baseUrl: string): Promise<IceConfig> {
  try {
    const url = baseUrl.replace(/\/$/, '') + '/api/turn-credentials'
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { iceServers?: RTCIceServer[] }
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      throw new Error('empty iceServers')
    }
    return { iceServers: data.iceServers, iceTransportPolicy: 'relay' }
  } catch (err) {
    console.warn('[ice] TURN fetch failed, falling back to static config:', (err as Error).message)
    return buildIceConfig()
  }
}

/**
 * Build ICE config from env vars (static credentials or STUN fallback).
 */
export function buildIceConfig(): IceConfig {
  const turnUrls = process.env['TURN_URLS']
  const turnUser = process.env['TURN_USERNAME']
  const turnCred = process.env['TURN_CREDENTIAL']

  if (turnUrls) {
    const urls = turnUrls.split(',').map(u => u.trim()).filter(Boolean)
    const turnServer: RTCIceServer = { urls }
    if (turnUser) turnServer.username = turnUser
    if (turnCred) turnServer.credential = turnCred
    return { iceServers: [turnServer], iceTransportPolicy: 'relay' }
  }

  return { iceServers: STUN_SERVERS }
}
