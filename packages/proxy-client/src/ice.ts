/**
 * ICE configuration builder.
 *
 * When TURN_URLS is set, uses relay-only mode so neither peer exposes its own
 * IP or port — all WebRTC traffic flows through the TURN relay server.
 * Without TURN, falls back to STUN-only (direct P2P, public IPs required).
 *
 * Env vars:
 *   TURN_URLS       — comma-separated TURN URLs, e.g.
 *                     "turn:relay.example.com:3478,turns:relay.example.com:5349"
 *   TURN_USERNAME   — TURN credential username
 *   TURN_CREDENTIAL — TURN credential password
 */

const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.stunprotocol.org:3478" },
]

export interface IceConfig {
  iceServers: RTCIceServer[]
  iceTransportPolicy?: RTCIceTransportPolicy
}

export function buildIceConfig(): IceConfig {
  const turnUrls = process.env["TURN_URLS"]
  const turnUser = process.env["TURN_USERNAME"]
  const turnCred = process.env["TURN_CREDENTIAL"]

  if (turnUrls) {
    const urls = turnUrls.split(",").map(u => u.trim()).filter(Boolean)
    const turnServer: RTCIceServer = { urls }
    if (turnUser) turnServer.username = turnUser
    if (turnCred) turnServer.credential = turnCred

    return {
      // relay-only: ICE will only gather relay (TURN) candidates.
      // Neither side's real IP or port is included in the SDP offer/answer —
      // all data flows through the TURN relay, so no ports are exposed.
      iceServers: [turnServer],
      iceTransportPolicy: "relay",
    }
  }

  // No TURN configured — fall back to STUN P2P.
  // ICE will gather host + srflx candidates (public IP from NAT traversal).
  return { iceServers: STUN_SERVERS }
}
