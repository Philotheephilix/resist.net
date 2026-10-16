/**
 * Censored user — queries Arkiv for live volunteers, connects via WebRTC,
 * and exposes a local HTTP proxy on port 8080 that routes traffic through
 * the volunteer exit proxy.
 */

import wrtc from "wrtc"
import net from "net"
import dns from "dns"
import os from "os"
import fs from "fs"
import path from "path"
import { isPrivateIp } from "@resist/shared/src/ip.js"
import { ArkivClient } from "@resist/arkiv-sdk/src/client.js"

const { RTCPeerConnection } = wrtc

const BOOTSTRAP_CACHE_PATH = path.join(os.homedir(), ".resist-net", "bootstrap-cache.json")
const LOCAL_PROXY_PORT = 8080

export interface UserConfig {
  wallet: string
  privateKey: string
  myGeohash: string
  rpcUrl?: string
}

export interface ProxyConnection {
  proxyPort: number
  volunteerWallet: string
  disconnect(): Promise<void>
}

interface BootstrapEntry {
  wallet: string
  sdpOffer: string
  geohash: string
}

const BOOTSTRAP_CACHE_MAX_BYTES = 8 * 1024 * 1024 // 8 MB hard cap to prevent OOM on load

function loadBootstrapCache(): BootstrapEntry[] {
  try {
    if (fs.existsSync(BOOTSTRAP_CACHE_PATH)) {
      const stat = fs.statSync(BOOTSTRAP_CACHE_PATH)
      if (stat.size > BOOTSTRAP_CACHE_MAX_BYTES) return []
      return JSON.parse(fs.readFileSync(BOOTSTRAP_CACHE_PATH, "utf8")) as BootstrapEntry[]
    }
  } catch {
    // ignore
  }
  return []
}

function saveBootstrapCache(entries: BootstrapEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(BOOTSTRAP_CACHE_PATH), { recursive: true })
    fs.writeFileSync(BOOTSTRAP_CACHE_PATH, JSON.stringify(entries, null, 2), { mode: 0o600 })
  } catch {
    // ignore
  }
}

/**
 * Wait for ICE connection to reach 'connected' state, with 30s timeout.
 */
function waitForIceConnected(peer: RTCPeerConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
      resolve()
      return
    }
    const timeout = setTimeout(() => {
      reject(new Error("ICE connection timeout after 30s"))
    }, 30_000)

    peer.addEventListener("iceconnectionstatechange", () => {
      const state = peer.iceConnectionState
      if (state === "connected" || state === "completed") {
        clearTimeout(timeout)
        resolve()
      } else if (state === "failed" || state === "closed") {
        clearTimeout(timeout)
        reject(new Error(`ICE connection failed: ${state}`))
      }
    })
  })
}

/**
 * Wait for ICE gathering to complete, or 3s timeout.
 */
function waitForIceCandidates(peer: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === "complete") {
      resolve()
      return
    }
    const timeout = setTimeout(resolve, 3000)
    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout)
        resolve()
      }
    })
  })
}

/**
 * Forward a TCP socket's traffic through a WebRTC DataChannel.
 * Opens a new DataChannel per TCP connection.
 */
function bridgeSocketToDataChannel(
  socket: net.Socket,
  peer: RTCPeerConnection,
  label: string
): void {
  // Pause BEFORE registering the 'data' listener to ensure no bytes
  // are emitted before the DataChannel opens and we are ready to forward.
  socket.pause()

  // 30s timeout guards against a stalled DataChannel that never fires 'open',
  // preventing leaked file descriptors (mirrors volunteer.ts wireTcpToChannel).
  socket.setTimeout(30_000)
  socket.on("timeout", () => {
    try { channel.close() } catch { /* ignore */ }
    socket.destroy()
  })

  const channel = peer.createDataChannel(label)

  channel.addEventListener("open", () => {
    socket.resume()
  })

  channel.addEventListener("message", (event: MessageEvent) => {
    const data = Buffer.isBuffer(event.data)
      ? (event.data as Buffer)
      : Buffer.from(event.data as ArrayBuffer)
    // Backpressure: cap write buffer to prevent OOM from relay flooding
    const drained = socket.write(data)
    if (!drained) {
      const writableLength = (socket as unknown as { writableLength: number }).writableLength
      if (writableLength > 1_048_576) {
        try { channel.close() } catch { /* ignore */ }
        socket.destroy()
      }
    }
  })

  channel.addEventListener("close", () => {
    socket.destroy()
  })

  channel.addEventListener("error", () => {
    socket.destroy()
  })

  socket.on("data", (chunk: Buffer) => {
    try {
      if (channel.readyState === "open") {
        channel.send(new Uint8Array(chunk))
      }
    } catch {
      socket.destroy()
    }
  })

  socket.on("end", () => {
    try { channel.close() } catch { /* ignore */ }
  })

  socket.on("error", () => {
    try { channel.close() } catch { /* ignore */ }
  })
}

/**
 * Start a local HTTP proxy server that bridges each connection over the
 * given WebRTC peer connection.
 * Returns the net.Server so the caller can close it.
 */
async function startLocalProxy(peer: RTCPeerConnection, port: number): Promise<net.Server> {
  let channelCounter = 0

  const server = net.createServer((socket) => {
    const label = `proxy-${++channelCounter}`
    bridgeSocketToDataChannel(socket, peer, label)
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })

  return server
}

/**
 * Find a live volunteer (outside our geohash prefix) and establish a WebRTC
 * connection, then start a local HTTP proxy on port 8080.
 */
export async function findAndConnect(config: UserConfig): Promise<ProxyConnection> {
  const rpcUrl = config.rpcUrl ?? process.env["ARKIV_RPC_URL"]
  const privateKey = config.privateKey ?? process.env["DEV_PRIVATE_KEY"]

  if (!rpcUrl) throw new Error("rpcUrl / ARKIV_RPC_URL required")
  if (!privateKey) throw new Error("privateKey / DEV_PRIVATE_KEY required")

  const arkiv = new ArkivClient({
    rpcUrl,
    privateKey: privateKey as `0x${string}`,
  })

  const geohashPrefix = config.myGeohash.slice(0, 3)

  // 1. Query Arkiv for volunteers in a different region
  let volunteers
  try {
    volunteers = await arkiv.queryVolunteers(geohashPrefix)
    // Update bootstrap cache with fresh data
    const freshEntries: BootstrapEntry[] = volunteers
      .filter((v) => v.sdpoffer.length <= 131072)
      .map((v) => ({
        wallet: v.wallet,
        sdpOffer: v.sdpoffer,
        geohash: v.geohash,
      }))
    const existingCache = loadBootstrapCache().filter(
      (e) => !freshEntries.find((f) => f.wallet === e.wallet)
    )
    saveBootstrapCache([...freshEntries, ...existingCache].slice(0, 50))
  } catch (err) {
    console.error("[user] Arkiv query failed, trying bootstrap cache:", (err as Error).message)
    // Fall back to bootstrap cache, excluding same geohash prefix
    const cached = loadBootstrapCache().filter(
      (e) => !e.geohash.startsWith(geohashPrefix)
    )
    if (cached.length === 0) throw new Error("No volunteers available — Arkiv unreachable and cache empty")
    // Convert to VolunteerProxyRow shape
    volunteers = cached.map((e) => ({
      entityKey: "",
      wallet: e.wallet,
      sdpoffer: e.sdpOffer,
      geohash: e.geohash,
      capacityslots: 1,
      createdat: 0,
    }))
  }

  // 2. Pick first available volunteer with capacity
  const chosen = volunteers.find((v) => v.capacityslots > 0)
  if (!chosen) throw new Error("No volunteers with available capacity found")

  console.log(`[user] Connecting to volunteer: ${chosen.wallet} (${chosen.geohash})`)

  // 3. Create WebRTC peer connection
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  }) as RTCPeerConnection

  // 4. Validate volunteer's SDP offer before setting as remote description
  if (chosen.sdpoffer.length > 131072) {
    peer.close()
    throw new Error("Volunteer SDP offer too large")
  }
  const offerDesc = JSON.parse(chosen.sdpoffer) as RTCSessionDescriptionInit
  if (
    typeof offerDesc !== "object" ||
    offerDesc === null ||
    offerDesc.type !== "offer" ||
    typeof offerDesc.sdp !== "string" ||
    offerDesc.sdp.length === 0 ||
    offerDesc.sdp.length > 65536 // 64KB max
  ) {
    peer.close()
    throw new Error("Volunteer SDP offer has invalid shape")
  }
  // Validate ICE candidates and sanitize the SDP to prevent DNS rebinding TOCTOU.
  // Strategy: reject private IP literals, resolve hostnames (both A and AAAA to
  // prevent IPv6 ULA bypass), replace hostname addresses with resolved IPs so the
  // WebRTC engine never re-resolves them independently (TOCTOU window eliminated).
  // mDNS / unresolvable hostnames are dropped.
  const MAX_OFFER_CANDIDATES = 50
  const offerCandidateCount = offerDesc.sdp.split("\n").filter(l => l.startsWith("a=candidate:")).length
  if (offerCandidateCount > MAX_OFFER_CANDIDATES) {
    peer.close()
    throw new Error(`Volunteer SDP has too many candidates: ${offerCandidateCount}`)
  }
  let offerRejected = false
  const sanitizedOfferLines: string[] = []
  for (const line of offerDesc.sdp.split("\n")) {
    if (!line.startsWith("a=candidate:")) {
      sanitizedOfferLines.push(line)
      continue
    }
    const m = /a=candidate:[^\s]+ [^\s]+ [^\s]+ [^\s]+ ([^\s]+) /.exec(line)
    if (!m) {
      sanitizedOfferLines.push(line)
      continue
    }
    const candidateAddr = m[1]!
    // mDNS candidates could mask LAN addresses — drop
    if (candidateAddr.endsWith(".local")) {
      peer.close()
      throw new Error(`Volunteer SDP contains mDNS candidate: ${candidateAddr}`)
    }
    const isIpv4Literal = /^[\d.]+$/.test(candidateAddr)
    const isIpv6Literal = /^[0-9a-fA-F:]+$/.test(candidateAddr) && candidateAddr.includes(":")
    const isIpLiteral = isIpv4Literal || isIpv6Literal
    if (!isIpLiteral && /^[0-9a-fA-F]+$/.test(candidateAddr)) {
      peer.close()
      throw new Error(`Volunteer SDP contains ambiguous hex-only candidate: ${candidateAddr}`)
    }
    if (isIpLiteral) {
      if (isPrivateIp(candidateAddr)) {
        peer.close()
        throw new Error(`Volunteer SDP contains private candidate IP: ${candidateAddr}`)
      }
      // Strip raddr field in srflx/relay candidates — it leaks the volunteer's LAN IP.
      const sanitizedLine = line.replace(/ raddr [^\s]+ rport \d+/g, ' raddr 0.0.0.0 rport 0')
      sanitizedOfferLines.push(sanitizedLine)
    } else {
      // Hostname candidate — resolve both A and AAAA to prevent IPv6 ULA bypass,
      // then replace hostname with resolved IP to prevent TOCTOU re-resolution.
      try {
        const [v4, v6] = await Promise.allSettled([
          dns.promises.lookup(candidateAddr, { family: 4 }),
          dns.promises.lookup(candidateAddr, { family: 6 }),
        ])
        const resolved4 = v4.status === "fulfilled" ? v4.value.address : null
        const resolved6 = v6.status === "fulfilled" ? v6.value.address : null
        if (resolved4 && isPrivateIp(resolved4)) {
          peer.close()
          throw new Error(`Volunteer SDP hostname resolves to private IPv4: ${candidateAddr} → ${resolved4}`)
        }
        if (resolved6 && isPrivateIp(resolved6)) {
          peer.close()
          throw new Error(`Volunteer SDP hostname resolves to private IPv6: ${candidateAddr} → ${resolved6}`)
        }
        // Replace ALL occurrences to prevent DNS rebinding via crafted foundation fields.
        const resolvedAddr = resolved4 ?? resolved6
        if (resolvedAddr) {
          sanitizedOfferLines.push(line.replaceAll(candidateAddr, resolvedAddr))
        }
        // Unresolvable from both families — drop silently
      } catch (err) {
        if ((err as Error).message.startsWith("Volunteer SDP")) {
          offerRejected = true
          throw err
        }
        // DNS resolution failed for unknown hostname — drop candidate
      }
    }
  }
  if (offerRejected) return  // already threw, but satisfy control-flow analysis
  const sanitizedOffer: RTCSessionDescriptionInit = {
    type: offerDesc.type,
    sdp: sanitizedOfferLines.join("\n"),
  }
  await peer.setRemoteDescription(sanitizedOffer)

  // 5. Create SDP answer
  const answer = await peer.createAnswer()

  // 6. Set local description
  await peer.setLocalDescription(answer)

  // Wait for ICE candidates to gather
  await waitForIceCandidates(peer)

  // 7. Publish SDP answer to Arkiv
  const sdpAnswerJson = JSON.stringify(peer.localDescription)
  try {
    await arkiv.writeSignalExchange({
      volunteerWallet: chosen.wallet,
      clientWallet: config.wallet,
      sdpAnswer: sdpAnswerJson,
      createdAt: Date.now(),
    })
  } catch (err) {
    console.error("[user] Failed to publish SDP answer:", (err as Error).message)
    // Continue — volunteer may still receive via other means
  }

  // 8. Wait for ICE connection to establish.
  // 9. Start local proxy. Both steps run inside a try block so that on any
  // failure (ICE timeout, port in use) the RTCPeerConnection is explicitly
  // closed rather than leaked with its STUN/ICE background tasks still running.
  let server: import("net").Server
  try {
    await waitForIceConnected(peer)
    console.log(`[user] WebRTC connected to ${chosen.wallet}`)
    server = await startLocalProxy(peer, LOCAL_PROXY_PORT)
    console.log(`[user] Local HTTP proxy listening on 127.0.0.1:${LOCAL_PROXY_PORT}`)
  } catch (err) {
    peer.close()
    throw err
  }

  return {
    proxyPort: LOCAL_PROXY_PORT,
    volunteerWallet: chosen.wallet,
    async disconnect(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      peer.close()
      console.log("[user] Disconnected from proxy")
    },
  }
}
