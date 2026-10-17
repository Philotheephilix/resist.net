/**
 * Volunteer proxy — registers on Arkiv, accepts WebRTC connections from censored users.
 * Publishes SDP offer with 5min TTL, refreshes every 4min while alive.
 * On connection: acts as exit proxy forwarding HTTP requests over DataChannels.
 */

import wrtc from "wrtc"
import net from "net"
import dns from "dns/promises"
import os from "os"
import fs from "fs"
import path from "path"
import { isPrivateIp } from "@resist/shared/src/ip.js"
import { ArkivClient } from "@resist/arkiv-sdk/src/client.js"

const { RTCPeerConnection } = wrtc

// Redact any URL matching the RPC endpoint from error messages to prevent
// accidental exposure of API keys embedded in the URL path.
function redactErrMsg(err: unknown, rpcUrl?: string): string {
  const msg = (err instanceof Error ? err.message : String(err)) ?? ""
  if (!rpcUrl) return msg.replace(/https?:\/\/\S+/g, "[url-redacted]")
  try {
    const u = new URL(rpcUrl)
    return msg.replaceAll(rpcUrl, u.origin + "/[REDACTED]")
      .replace(/https?:\/\/\S+/g, "[url-redacted]")
  } catch {
    return msg.replace(/https?:\/\/\S+/g, "[url-redacted]")
  }
}

const OFFER_TTL_MS = 5 * 60 * 1000
const REFRESH_INTERVAL_MS = 4 * 60 * 1000
const POLL_INTERVAL_MS = 10 * 1000
// Faster poll rate used for the first FAST_POLL_WINDOW_MS after a new offer is
// published. Reduces the worst-case signalling lag from ~10 s to ~3 s, giving
// the user's 30 s ICE timeout comfortable headroom even on slow networks.
const FAST_POLL_INTERVAL_MS = 3 * 1000
const FAST_POLL_WINDOW_MS = 60 * 1000

const BOOTSTRAP_CACHE_PATH = path.join(os.homedir(), ".resist-net", "bootstrap-cache.json")

export interface VolunteerConfig {
  wallet: string
  privateKey: string
  geohash: string
  rpcUrl?: string
  capacitySlots?: number
}

interface BootstrapEntry {
  wallet: string
  sdpOffer: string
  geohash: string
}

const BOOTSTRAP_CACHE_MAX_BYTES = 8 * 1024 * 1024 // 8 MB — prevents OOM on a bloated cache file

function loadBootstrapCache(): BootstrapEntry[] {
  try {
    if (fs.existsSync(BOOTSTRAP_CACHE_PATH)) {
      const stat = fs.statSync(BOOTSTRAP_CACHE_PATH)
      if (stat.size > BOOTSTRAP_CACHE_MAX_BYTES) return []
      const parsed = JSON.parse(fs.readFileSync(BOOTSTRAP_CACHE_PATH, "utf8"))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(
        (e: unknown): e is BootstrapEntry =>
          e !== null &&
          typeof e === "object" &&
          typeof (e as BootstrapEntry).wallet === "string" &&
          (e as BootstrapEntry).wallet.length > 0 &&
          (e as BootstrapEntry).wallet.length <= 256 &&
          typeof (e as BootstrapEntry).sdpOffer === "string" &&
          (e as BootstrapEntry).sdpOffer.length > 0 &&
          (e as BootstrapEntry).sdpOffer.length <= 131072 &&
          typeof (e as BootstrapEntry).geohash === "string" &&
          (e as BootstrapEntry).geohash.length > 0 &&
          (e as BootstrapEntry).geohash.length <= 64
      )
    }
  } catch {
    // ignore
  }
  return []
}

function saveBootstrapCache(entries: BootstrapEntry[]): void {
  try {
    const dir = path.dirname(BOOTSTRAP_CACHE_PATH)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.bootstrap-cache.tmp.${process.pid}.${Date.now().toString(16)}.json`)
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, BOOTSTRAP_CACHE_PATH)
  } catch {
    // ignore
  }
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
 * Resolve hostname to IP and check if it's private.
 * Returns { blocked: true } if connection should be denied, or { ip } on success.
 * This prevents SSRF via non-standard IP representations and DNS rebinding.
 */
async function resolveAndCheckHost(host: string): Promise<{ blocked: boolean; ip?: string }> {
  // Reject obvious loopback/link-local names before DNS
  if (/^(localhost|local)$/i.test(host)) return { blocked: true }

  // For bare IPv6 literals (no brackets, already extracted by the CONNECT parser)
  // skip dns.lookup entirely — just validate and classify the address.
  // dns.lookup({family:4}) silently ignores the hint for IPv6 literals and returns
  // them as-is with family=6, making the family:4 restriction ineffective.
  const isIPv6Literal = /^[0-9a-fA-F:]+$/.test(host) && host.includes(":")
  if (isIPv6Literal) {
    return isPrivateIp(host) ? { blocked: true } : { blocked: false, ip: host }
  }

  try {
    // Resolve both A and AAAA to prevent IPv6 ULA bypass.
    // dns.lookup family:4 does not restrict IPv6 literals, so we use explicit
    // family variants and accept either a public IPv4 or IPv6 result.
    // Timer handles are stored so they can be cleared when DNS wins the race,
    // preventing lingering timers from keeping the event loop alive.
    let timer4: ReturnType<typeof setTimeout> | null = null
    let timer6: ReturnType<typeof setTimeout> | null = null
    const [v4, v6] = await Promise.allSettled([
      Promise.race([
        dns.lookup(host, { family: 4 }).finally(() => { if (timer4 !== null) { clearTimeout(timer4); timer4 = null } }),
        new Promise<never>((_, reject) => { timer4 = setTimeout(() => reject(new Error("DNS timeout")), 5000) }),
      ]),
      Promise.race([
        dns.lookup(host, { family: 6 }).finally(() => { if (timer6 !== null) { clearTimeout(timer6); timer6 = null } }),
        new Promise<never>((_, reject) => { timer6 = setTimeout(() => reject(new Error("DNS timeout")), 5000) }),
      ]),
    ])
    const resolved4 = v4.status === "fulfilled" ? v4.value.address : null
    const resolved6 = v6.status === "fulfilled" ? v6.value.address : null
    // Block if any resolution is private (prevent IPv6 ULA / dual-stack bypass)
    if (resolved4 && isPrivateIp(resolved4)) return { blocked: true }
    if (resolved6 && isPrivateIp(resolved6)) return { blocked: true }
    // Prefer IPv4 for the actual connection address (more predictable)
    const ip = resolved4 ?? resolved6
    if (!ip) return { blocked: true }
    return { blocked: false, ip }
  } catch {
    return { blocked: true }
  }
}

/**
 * Attach TCP socket I/O to a DataChannel with backpressure and timeout.
 * Called after socket is created.
 */
function wireTcpToChannel(tcpSocket: net.Socket, channel: RTCDataChannel): void {
  // 30s inactivity timeout — prevents hung sockets exhausting file descriptors
  tcpSocket.setTimeout(30_000)
  tcpSocket.on("timeout", () => {
    tcpSocket.destroy()
    try { channel.close() } catch { /* ignore */ }
  })

  tcpSocket.on("data", (data: Buffer) => {
    try {
      // Always send the current chunk first — the backpressure check must come
      // AFTER the send so we never silently drop the triggering chunk.
      channel.send(new Uint8Array(data))
      // Backpressure: after sending, check if the SCTP buffer is filling up and
      // pause the TCP source to prevent heap exhaustion from an upstream flood.
      if (channel.bufferedAmount > 1_048_576) {
        tcpSocket.pause()
        const drain = () => {
          if (channel.bufferedAmount <= 262_144) {
            tcpSocket.resume()
            channel.removeEventListener("bufferedamountlow", drain)
          }
        }
        channel.bufferedAmountLowThreshold = 262_144
        channel.addEventListener("bufferedamountlow", drain)
      }
    } catch {
      tcpSocket.destroy()
    }
  })

  tcpSocket.on("end", () => {
    try { channel.close() } catch { /* ignore */ }
  })

  // Do NOT echo err.message to client — it can contain internal VPC addresses/ports
  tcpSocket.on("error", () => {
    try {
      channel.send("HTTP/1.1 502 Bad Gateway\r\n\r\n")
      channel.close()
    } catch { /* ignore */ }
  })
}

/**
 * Handle an established data channel as an HTTP/CONNECT proxy.
 * Protocol: the user sends either:
 *   CONNECT host:port HTTP/1.1\r\n...\r\n  → TCP tunnel
 *   GET/POST ... HTTP/1.x\r\n...            → plain HTTP forward
 *
 * SSRF protection: resolves hostname via DNS before connecting; uses the
 * resolved IP for the actual connection to prevent DNS rebinding. Rejects
 * all private/loopback/link-local/RFC-6598 address ranges.
 */
function handleProxyChannel(channel: RTCDataChannel): void {
  let buffer = Buffer.alloc(0)
  let tcpSocket: net.Socket | null = null
  let tunnelEstablished = false
  let headerProcessed = false
  let channelClosed = false
  // Chunks arriving during async DNS resolution are buffered here and drained on connect
  const pendingChunks: Buffer[] = []
  let pendingChunksBytes = 0

  const onMessage = (event: MessageEvent) => {
    const chunk = Buffer.isBuffer(event.data)
      ? (event.data as Buffer)
      : Buffer.from(event.data as ArrayBuffer)

    if (tunnelEstablished && tcpSocket) {
      // Backpressure: if write buffer is full, wait for drain before accepting more data
      const drained = tcpSocket.write(new Uint8Array(chunk))
      if (!drained) {
        // DataChannel has no pause API — we can only drop or queue.
        // Cap queued-write backlog at 1MB to prevent OOM.
        const writableLength = (tcpSocket as unknown as { writableLength: number }).writableLength
        if (writableLength > 1_048_576) {
          tcpSocket.destroy()
          try { channel.close() } catch { /* ignore */ }
        }
      }
      return
    }

    // Buffer chunks arriving during async DNS resolution; drain after socket connects
    if (headerProcessed && !tunnelEstablished) {
      if (pendingChunksBytes + chunk.length > 1_048_576) {
        try { channel.send("HTTP/1.1 413 Request Entity Too Large\r\n\r\n"); channel.close() } catch { /* ignore */ }
        return
      }
      pendingChunks.push(chunk)
      pendingChunksBytes += chunk.length
      return
    }

    // Check size BEFORE concat to avoid temporary allocation beyond the limit
    if (buffer.length + chunk.length > 65536) {
      try { channel.send("HTTP/1.1 413 Request Entity Too Large\r\n\r\n"); channel.close() } catch { /* ignore */ }
      return
    }

    buffer = Buffer.concat([buffer, chunk])

    // Look for end of HTTP headers
    const headerEnd = buffer.indexOf("\r\n\r\n")
    if (headerEnd === -1) return // not yet complete

    headerProcessed = true
    const headerStr = buffer.slice(0, headerEnd).toString("utf8")
    const body = buffer.slice(headerEnd + 4)
    const firstLine = headerStr.split("\r\n")[0] ?? ""

    // Match both plain hostname/IPv4 and bracket-enclosed IPv6 (RFC 7230 §5.3.3):
    //   CONNECT example.com:443 HTTP/1.1
    //   CONNECT [2001:db8::1]:443 HTTP/1.1
    const connectMatch = /^CONNECT (\[.+?\]|[^:]+):(\d+) HTTP\//.exec(firstLine)
    if (connectMatch) {
      // CONNECT tunnel — async DNS + SSRF check
      // Strip brackets from IPv6 literals so dns.lookup receives a bare address
      const host = connectMatch[1]!.replace(/^\[(.+)\]$/, '$1')
      const port = parseInt(connectMatch[2]!, 10)

      if (port < 1 || port > 65535) {
        try { channel.send("HTTP/1.1 403 Forbidden\r\n\r\n"); channel.close() } catch { /* ignore */ }
        return
      }

      resolveAndCheckHost(host).then(({ blocked, ip }) => {
        if (channelClosed) return
        if (blocked || !ip) {
          try { channel.send("HTTP/1.1 403 Forbidden\r\n\r\n"); channel.close() } catch { /* ignore */ }
          return
        }

        // Connect to resolved IP — prevents DNS rebinding between check and connect
        const sock = net.createConnection(port, ip, () => {
          try { channel.send("HTTP/1.1 200 Connection Established\r\n\r\n") } catch { /* ignore */ }
          tunnelEstablished = true
          if (body.length > 0) sock.write(body)
          // Drain any chunks that arrived during DNS resolution
          for (const c of pendingChunks) sock.write(new Uint8Array(c))
          pendingChunks.length = 0
        })
        tcpSocket = sock
        wireTcpToChannel(sock, channel)
      }).catch(() => {
        try { channel.send("HTTP/1.1 502 Bad Gateway\r\n\r\n"); channel.close() } catch { /* ignore */ }
      })
    } else {
      // Plain HTTP request — extract host from Host: header.
      // Host values may be IPv6 brackets: [::1]:8080, [::1], or plain host:port.
      const hostHeader = headerStr
        .split("\r\n")
        .find((l) => /^host:/i.test(l))
      const hostVal = hostHeader?.split(":").slice(1).join(":").trim() ?? ""

      let hostname: string
      let port: number
      const ipv6BracketMatch = /^\[(.+?)\](?::(\d+))?$/.exec(hostVal)
      if (!ipv6BracketMatch && (hostVal.match(/:/g)?.length ?? 0) > 1) {
        try { channel.send("HTTP/1.1 400 Bad Request\r\n\r\n"); channel.close() } catch { /* ignore */ }
        return
      }
      if (ipv6BracketMatch) {
        hostname = ipv6BracketMatch[1]!             // bare IPv6 address without brackets
        port = ipv6BracketMatch[2] ? parseInt(ipv6BracketMatch[2], 10) : 80
      } else {
        const colonIdx = hostVal.lastIndexOf(":")
        if (colonIdx !== -1 && /^\d+$/.test(hostVal.slice(colonIdx + 1))) {
          hostname = hostVal.slice(0, colonIdx)
          port = parseInt(hostVal.slice(colonIdx + 1), 10)
        } else {
          hostname = hostVal
          port = 80
        }
      }

      if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
        try { channel.send("HTTP/1.1 403 Forbidden\r\n\r\n"); channel.close() } catch { /* ignore */ }
        return
      }

      resolveAndCheckHost(hostname).then(({ blocked, ip }) => {
        if (channelClosed) return
        if (blocked || !ip) {
          try { channel.send("HTTP/1.1 403 Forbidden\r\n\r\n"); channel.close() } catch { /* ignore */ }
          return
        }

        // Connect to resolved IP — prevents DNS rebinding
        const fullRequest = Buffer.concat([Buffer.from(headerStr + "\r\n\r\n"), body])
        const sock = net.createConnection(port, ip, () => {
          sock.write(fullRequest)
          tunnelEstablished = true
          // Drain any chunks that arrived during DNS resolution
          for (const c of pendingChunks) sock.write(new Uint8Array(c))
          pendingChunks.length = 0
        })
        tcpSocket = sock
        wireTcpToChannel(sock, channel)
      }).catch(() => {
        try { channel.send("HTTP/1.1 502 Bad Gateway\r\n\r\n"); channel.close() } catch { /* ignore */ }
      })
    }
  }

  channel.addEventListener("message", onMessage)

  channel.addEventListener("close", () => {
    channelClosed = true
    tcpSocket?.destroy()
  })
}

/**
 * Start the volunteer proxy.
 * Creates a WebRTC peer, publishes SDP offer to Arkiv, polls for answers,
 * and proxies HTTP traffic for each connected user.
 */
export async function startVolunteer(config: VolunteerConfig): Promise<void> {
  const rpcUrl = config.rpcUrl ?? process.env["ARKIV_RPC_URL"]
  const privateKey = config.privateKey ?? process.env["DEV_PRIVATE_KEY"]

  if (!rpcUrl) throw new Error("rpcUrl / ARKIV_RPC_URL required")
  if (!privateKey) throw new Error("privateKey / DEV_PRIVATE_KEY required")

  const arkiv = new ArkivClient({
    rpcUrl,
    privateKey: privateKey as `0x${string}`,
  })

  // Track answers we've already processed to avoid re-processing
  // TTL-keyed map instead of a bounded Set. A bounded Set with count-based
  // eviction allows a replay attack: flood with 5000 unique keys, evict a
  // real key, then re-publish the original answer. TTL eviction removes
  // entries based on age, so a flooded-and-evicted key stays evicted until
  // its TTL expires, not until 5000 new entries arrive.
  const PROCESSED_TTL_MS = 10 * 60_000 // 10 minutes — longer than SignalExchange TTL (2 min)
  const processedAnswers = new Map<string, number>() // entityKey → seenAt timestamp

  // Map from clientWallet → peer (so we can clean up)
  const peers = new Map<string, RTCPeerConnection>()

  /**
   * Create a fresh RTCPeerConnection with a control DataChannel,
   * gather ICE, and return { peer, sdpOfferJson, entityKey }.
   */
  async function createOffer(): Promise<{ peer: RTCPeerConnection; sdpOfferJson: string; entityKey: string }> {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
        { urls: "stun:stun.stunprotocol.org:3478" },
      ],
    }) as RTCPeerConnection

    // Control channel triggers ICE gathering
    peer.createDataChannel("control")

    // Per-peer concurrent channel cap — prevents a single client exhausting FDs/memory
    const MAX_CHANNELS = 50
    let activeChannels = 0

    // Accept per-request data channels from users
    peer.addEventListener("datachannel", (event: RTCDataChannelEvent) => {
      const ch = event.channel
      if (ch.label === "control") return
      if (activeChannels >= MAX_CHANNELS) {
        try { ch.close() } catch { /* ignore */ }
        return
      }
      activeChannels++
      ch.addEventListener("close", () => { activeChannels-- })
      handleProxyChannel(ch)
    })

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await waitForIceCandidates(peer)

    const sdpOfferJson = JSON.stringify(peer.localDescription)

    const MAX_PUBLISH_ATTEMPTS = 4
    let entityKey = ""
    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      try {
        entityKey = await arkiv.writeVolunteerProxy({
          wallet: config.wallet,
          sdpOffer: sdpOfferJson,
          geohash: config.geohash.slice(0, 5),
          capacitySlots: config.capacitySlots ?? 5,
          createdAt: Date.now(),
        })
        // Update bootstrap cache
        const cache = loadBootstrapCache().filter((e) => e.wallet !== config.wallet)
        if (cache.length === 0) {
          console.warn("[volunteer] Bootstrap cache is empty — this node is starting in cold-start isolation with no known peers")
        }
        cache.unshift({ wallet: config.wallet, sdpOffer: sdpOfferJson, geohash: config.geohash })
        saveBootstrapCache(cache.slice(0, 50))
        break
      } catch (err) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 16000)
        if (attempt < MAX_PUBLISH_ATTEMPTS) {
          console.error(
            `[volunteer] Arkiv write failed (attempt ${attempt}/${MAX_PUBLISH_ATTEMPTS}), retrying in ${backoffMs}ms:`,
            redactErrMsg(err, config.rpcUrl),
          )
          await new Promise((res) => setTimeout(res, backoffMs))
        } else {
          throw new Error(
            `[volunteer] FATAL: volunteer not discoverable via Arkiv after ${MAX_PUBLISH_ATTEMPTS} attempts — users cannot find this node. Last error: ${redactErrMsg(err, config.rpcUrl)}`,
          )
        }
      }
    }

    return { peer, sdpOfferJson, entityKey }
  }

  const MAX_STARTUP_ATTEMPTS = 10
  const STARTUP_BACKOFF_BASE_MS = 30_000
  const STARTUP_BACKOFF_MAX_MS = 300_000
  const STARTUP_RESET_SLEEP_MS = 10 * 60_000
  let startupResult: { peer: RTCPeerConnection; sdpOfferJson: string; entityKey: string } | undefined
  while (!startupResult) {
    for (let attempt = 1; attempt <= MAX_STARTUP_ATTEMPTS; attempt++) {
      try {
        startupResult = await createOffer()
        break
      } catch (err) {
        const backoffMs = Math.min(STARTUP_BACKOFF_BASE_MS * 2 ** (attempt - 1), STARTUP_BACKOFF_MAX_MS)
        if (attempt < MAX_STARTUP_ATTEMPTS) {
          console.error(
            `[volunteer] Startup failed (attempt ${attempt}/${MAX_STARTUP_ATTEMPTS}), retrying in ${backoffMs}ms:`,
            redactErrMsg(err, config.rpcUrl),
          )
          await new Promise((res) => setTimeout(res, backoffMs))
        } else {
          console.error(
            `[volunteer] Startup failed after ${MAX_STARTUP_ATTEMPTS} attempts, sleeping ${STARTUP_RESET_SLEEP_MS / 1000}s before next cycle:`,
            redactErrMsg(err, config.rpcUrl),
          )
          await new Promise((res) => setTimeout(res, STARTUP_RESET_SLEEP_MS))
        }
      }
    }
  }
  let { peer: mainPeer, entityKey } = startupResult!
  console.log(`[volunteer] Proxy active. Wallet: ${config.wallet}  Geohash: ${config.geohash}`)

  // Refresh TTL every 4 min
  let currentEntityKey = entityKey
  const refreshInterval = setInterval(async () => {
    try {
      if (currentEntityKey) {
        await arkiv.refreshVolunteerProxy(currentEntityKey)
      } else {
        // Re-publish if we didn't get an entity key earlier
        const result = await arkiv.writeVolunteerProxy({
          wallet: config.wallet,
          sdpOffer: JSON.stringify(mainPeer.localDescription),
          geohash: config.geohash.slice(0, 5),
          capacitySlots: config.capacitySlots ?? 5,
          createdAt: Date.now(),
        })
        currentEntityKey = result
      }
    } catch (err) {
      console.error("[volunteer] Refresh failed:", redactErrMsg(err, config.rpcUrl))
    }
  }, REFRESH_INTERVAL_MS)

  // Poll for incoming SDP answers.
  // Orphaned signalExchange entities (created by users whose ICE timed out before
  // the volunteer processed the answer) accumulate on Arkiv until their on-chain TTL
  // expires (~2 min). On a successful connection the user deletes the entity immediately
  // after ICE connects; Arkiv TTL expiry is a safety net for abrupt disconnects only.
  // processedAnswers TTL (10 min) exceeds the signalExchange TTL so a
  // re-published answer from a retrying client is still accepted.
  //
  // The Arkiv query and the answer-processing loop are decoupled: `queryRunning`
  // serialises only the lightweight RPC fetch, while `processRunning` serialises the
  // heavier setRemoteDescription work. This lets the next scheduled tick fetch fresh
  // answers even when the previous processing pass is still in-flight.
  let queryRunning = false
  let processRunning = false
  let lastOfferPublishedAt = Date.now() // set to now; updated whenever createOffer succeeds
  // Answers fetched by the query loop, handed to the processing loop
  let pendingAnswers: Awaited<ReturnType<typeof arkiv.querySignalExchange>> = []

  // Use a self-rescheduling timer so we can vary the interval dynamically.
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let consecutivePollFailures = 0
  const schedulePoll = () => {
    const elapsed = Date.now() - lastOfferPublishedAt
    let interval: number
    if (consecutivePollFailures >= 3) {
      interval = Math.min(FAST_POLL_INTERVAL_MS * Math.pow(2, consecutivePollFailures - 2), 30_000)
    } else {
      interval = elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    }
    pollTimer = setTimeout(runPoll, interval + Math.random() * 500)
  }

  const runPoll = async () => {
    // --- Fetch phase (serialised) ---
    if (!queryRunning) {
      queryRunning = true
      try {
        const fetched = await arkiv.querySignalExchange(config.wallet)
        consecutivePollFailures = 0
        // Merge new answers into pending, deduplicating by entityKey
        for (const row of fetched) {
          if (!pendingAnswers.some(r => r.entityKey === row.entityKey)) {
            pendingAnswers.push(row)
          }
        }
      } catch (err) {
        consecutivePollFailures++
        console.error("[volunteer] Poll failed:", redactErrMsg(err, config.rpcUrl))
      } finally {
        queryRunning = false
      }
    }

    // --- Process phase (serialised separately so fetch can run next tick) ---
    if (processRunning || pendingAnswers.length === 0) {
      schedulePoll()
      return
    }
    processRunning = true
    // Snapshot and clear pending; we'll process this batch
    let answers = pendingAnswers.splice(0)
    let recreateFailed = false
    try {
    // Cap answers to prevent a flooded signal exchange from stalling the loop
    answers = answers.slice(0, 20)

    if (
      mainPeer.signalingState === "closed" ||
      mainPeer.connectionState === "failed" ||
      mainPeer.connectionState === "closed"
    ) {
      console.warn("[volunteer] mainPeer is in terminal state; creating fresh peer")
      try {
        const result = await createOffer()
        mainPeer = result.peer
        currentEntityKey = result.entityKey
        lastOfferPublishedAt = Date.now()
      } catch (err) {
        console.error("[volunteer] Failed to recreate mainPeer:", redactErrMsg(err, config.rpcUrl))
        recreateFailed = true
      }
    }

    if (recreateFailed) {
      schedulePoll()
      return
    }

    // Evict stale entries from the TTL map on every poll cycle
    const now = Date.now()
    for (const [key, seenAt] of processedAnswers) {
      if (now - seenAt > PROCESSED_TTL_MS) processedAnswers.delete(key)
    }

    for (const row of answers) {
      if (processedAnswers.has(row.entityKey)) continue
      processedAnswers.set(row.entityKey, now)

      const clientWallet = row.clientwallet
      console.log(`[volunteer] New SDP answer from ${clientWallet}`)

      let peer = peers.get(clientWallet)
      if (!peer) {
        if (
          mainPeer.signalingState === "have-local-offer" ||
          mainPeer.signalingState === "stable" && mainPeer.connectionState === "new"
        ) {
          // mainPeer is awaiting or was just offered — safe to reuse for this client
          peer = mainPeer
          peers.set(clientWallet, peer)
        } else {
          // mainPeer already completed a handshake. Create a fresh offer for this
          // client so it can complete its own offer/answer cycle on the next attempt.
          try {
            const result = await createOffer()
            peers.set(clientWallet, result.peer)
            currentEntityKey = result.entityKey
            lastOfferPublishedAt = Date.now()
            console.log(`[volunteer] Published fresh offer for ${clientWallet} (mainPeer already connected)`)
          } catch (err) {
            console.error(`[volunteer] Failed to create offer for ${clientWallet}:`, redactErrMsg(err, config.rpcUrl))
          }
          // The current answer was generated against mainPeer's offer and cannot be
          // applied to the new peer — skip it; the client must re-query Arkiv and
          // submit a new answer against the freshly published offer.
          continue
        }
      }

      if (
        peer.signalingState === "closed" ||
        peer.connectionState === "failed" ||
        peer.connectionState === "closed"
      ) {
        console.warn(`[volunteer] Cannot accept answer from ${clientWallet} — peer is in state ${peer.connectionState}`)
        peers.delete(clientWallet)
        continue
      }

      try {
        if (row.sdpanswer.length > 131072) {
          console.error(`[volunteer] SDP answer too large from ${clientWallet} (${row.sdpanswer.length} bytes)`)
          continue
        }
        const answerDesc = JSON.parse(row.sdpanswer) as RTCSessionDescriptionInit
        // Validate SDP shape before passing to WebRTC engine
        if (
          typeof answerDesc !== "object" ||
          answerDesc === null ||
          answerDesc.type !== "answer" ||
          typeof answerDesc.sdp !== "string" ||
          answerDesc.sdp.length === 0 ||
          answerDesc.sdp.length > 65536
        ) {
          console.error(`[volunteer] Invalid SDP shape from ${clientWallet}`)
          continue
        }
        // Validate ICE candidates and strip any that could cause DNS TOCTOU
        // (DNS rebinding). Strategy: reject any candidate whose address is not
        // an IP literal, or whose IP is private/reserved. Hostname-type candidates
        // are stripped entirely — not passed to setRemoteDescription — because the
        // WebRTC engine would re-resolve them independently (TOCTOU window).
        // Also check IPv6 AAAA records separately to prevent ULA bypass.
        //
        // Cap: a legitimate SDP rarely has more than 20 ICE candidates; >50 strongly
        // suggests a crafted SDP intended to stall the poll loop via sequential DNS
        // resolution (each hostname lookup up to 30s with system default timeout).
        const MAX_CANDIDATES = 50
        const MAX_HOSTNAME_CANDIDATES = 5
        const sdpLines = answerDesc.sdp.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
        const candidateLineCount = sdpLines.filter(l => l.startsWith("a=candidate:")).length
        if (candidateLineCount > MAX_CANDIDATES) {
          console.error(`[volunteer] SDP from ${clientWallet} has ${candidateLineCount} candidates (max ${MAX_CANDIDATES}), skipping`)
          continue
        }
        let candidateRejected = false
        const sanitizedLines: string[] = []

        // --- Pass 1: collect hostname candidates for parallel DNS resolution ---
        // Extract up to MAX_HOSTNAME_CANDIDATES unique hostnames so we can fire
        // all lookups simultaneously rather than serially (which would block the
        // poll loop for up to MAX_HOSTNAME_CANDIDATES * 2 * DNS_TIMEOUT seconds).
        type HostnameCandidate = { hostname: string; lineIdx: number }
        const hostnameCandidates: HostnameCandidate[] = []
        let tooManyHostnames = false
        for (let i = 0; i < sdpLines.length; i++) {
          const line = sdpLines[i]!
          if (!line.startsWith("a=candidate:")) continue
          const m = /a=candidate:[^\s]+ [^\s]+ [^\s]+ [^\s]+ ([^\s]+) /.exec(line)
          if (!m) continue
          const addr = m[1]!
          if (addr.endsWith(".local")) continue
          const isIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
          const isIpv6 = /^[0-9a-fA-F:]+$/.test(addr) && addr.includes(":")
          if (!isIpv4 && !isIpv6) {
            hostnameCandidates.push({ hostname: addr, lineIdx: i })
            if (hostnameCandidates.length > MAX_HOSTNAME_CANDIDATES) {
              tooManyHostnames = true
              break
            }
          }
        }
        if (tooManyHostnames) {
          console.error(`[volunteer] Too many hostname candidates from ${clientWallet}, skipping SDP`)
          if (peer !== mainPeer) { peer.close() }
          peers.delete(clientWallet)
          continue
        }

        // Resolve all hostname candidates in parallel, each with a 5 s timeout.
        type DnsResult = { resolved4: string | null; resolved6: string | null }
        const dnsResults = new Map<string, DnsResult>()
        if (hostnameCandidates.length > 0) {
          const uniqueHostnames = [...new Set(hostnameCandidates.map(c => c.hostname))]
          const lookupResults = await Promise.allSettled(
            uniqueHostnames.map(async (hostname) => {
              let timer4: ReturnType<typeof setTimeout> | null = null
              let timer6: ReturnType<typeof setTimeout> | null = null
              const [v4, v6] = await Promise.allSettled([
                Promise.race([
                  dns.lookup(hostname, { family: 4 }).finally(() => { if (timer4 !== null) { clearTimeout(timer4); timer4 = null } }),
                  new Promise<never>((_, reject) => { timer4 = setTimeout(() => reject(new Error("DNS timeout")), 5000) }),
                ]),
                Promise.race([
                  dns.lookup(hostname, { family: 6 }).finally(() => { if (timer6 !== null) { clearTimeout(timer6); timer6 = null } }),
                  new Promise<never>((_, reject) => { timer6 = setTimeout(() => reject(new Error("DNS timeout")), 5000) }),
                ]),
              ])
              return {
                hostname,
                resolved4: v4.status === "fulfilled" ? v4.value.address : null,
                resolved6: v6.status === "fulfilled" ? v6.value.address : null,
              }
            })
          )
          for (const r of lookupResults) {
            if (r.status === "fulfilled") {
              dnsResults.set(r.value.hostname, { resolved4: r.value.resolved4, resolved6: r.value.resolved6 })
            }
          }
        }

        // --- Pass 2: build sanitized SDP using pre-resolved DNS results ---
        for (const line of sdpLines) {
          if (!line.startsWith("a=candidate:")) {
            // Sanitize non-candidate address-bearing lines to prevent private IP leakage
            // via c= (connection) and a=rtcp: lines. Modern DataChannel-only connections
            // use ICE candidates exclusively, but we sanitize defensively in case the
            // wrtc version changes or a non-ICE fallback is triggered.
            // c= connection line: rewrite to unspecified address matching addrtype.
            // IP4 → 0.0.0.0 (IPv4 unspecified); IP6 → :: (IPv6 unspecified).
            // Using 0.0.0.0 for IP6 would be RFC 4566-invalid and causes libwebrtc
            // to throw in setRemoteDescription.
            if (/^c=IN IP4 /.test(line)) {
              sanitizedLines.push(line.replace(/^(c=IN IP4 )\S+/, '$10.0.0.0'))
              continue
            }
            if (/^c=IN IP6 /.test(line)) {
              sanitizedLines.push(line.replace(/^(c=IN IP6 )\S+/, '$1::'))
              continue
            }
            // a=rtcp: same addrtype-aware substitution
            if (/^a=rtcp:\d+ IN IP4 /.test(line)) {
              sanitizedLines.push(line.replace(/(^a=rtcp:\d+ IN IP4 )\S+/, '$10.0.0.0'))
              continue
            }
            if (/^a=rtcp:\d+ IN IP6 /.test(line)) {
              sanitizedLines.push(line.replace(/(^a=rtcp:\d+ IN IP6 )\S+/, '$1::'))
              continue
            }
            // o= origin line: <username> <sess-id> <sess-version> IN IP4/IP6 <addr>
            // wrtc embeds the LAN IP here; rewrite to unspecified address.
            if (/^o=\S+ \S+ \S+ IN IP4 /.test(line)) {
              sanitizedLines.push(line.replace(/(o=\S+ \S+ \S+ IN IP4 )\S+/, '$10.0.0.0'))
              continue
            }
            if (/^o=\S+ \S+ \S+ IN IP6 /.test(line)) {
              sanitizedLines.push(line.replace(/(o=\S+ \S+ \S+ IN IP6 )\S+/, '$1::'))
              continue
            }
            sanitizedLines.push(line)
            continue
          }
          const m = /a=candidate:[^\s]+ [^\s]+ [^\s]+ [^\s]+ ([^\s]+) /.exec(line)
          if (!m) {
            // Malformed candidate — fewer than 5 fields, cannot safely classify the address.
            // Pass-through would bypass all IP checks; drop it instead.
            continue
          }
          const candidateAddr = m[1]!
          // mDNS candidates (.local) could mask LAN addresses — drop
          if (candidateAddr.endsWith(".local")) {
            console.error(`[volunteer] Dropping mDNS candidate from ${clientWallet}: ${candidateAddr}`)
            continue
          }
          // Accept dotted-decimal IPv4 (contains dots) or colon-notation IPv6 (contains colons).
          // Reject any hex-only string with no separators — it cannot be safely classified as
          // an IPv4 or IPv6 literal and may be a hex-encoded IPv4 (e.g. 7f000001 = 127.0.0.1).
          const isIpv4Literal = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(candidateAddr)
          const isIpv6Literal = /^[0-9a-fA-F:]+$/.test(candidateAddr) && candidateAddr.includes(":")
          const isIpLiteral = isIpv4Literal || isIpv6Literal
          if (!isIpLiteral && /^[0-9a-fA-F]+$/.test(candidateAddr)) {
            // Bare hex string — ambiguous, could be hex-encoded IPv4. Treat as private to deny.
            console.error(`[volunteer] Dropping ambiguous hex candidate from ${clientWallet}: ${candidateAddr}`)
            candidateRejected = true
            break
          }
          if (isIpLiteral) {
            if (isPrivateIp(candidateAddr)) {
              console.error(`[volunteer] Dropping private IP candidate from ${clientWallet}: ${candidateAddr}`)
              candidateRejected = true
              break
            }
            // Strip raddr field in srflx/relay candidates — it contains the volunteer's
            // LAN IP and leaks the private network topology to the connecting client.
            // Use addrtype-aware replacement: IPv6 candidates require '::' not '0.0.0.0'
            // (same rationale as c= and a=rtcp: lines: RFC 4566-invalid to mix families).
            const raddrReplacement = isIpv6Literal ? ':: rport 0' : '0.0.0.0 rport 0'
            const sanitizedLine = line.replace(/ raddr [^\s]+ rport \d+/g, ` raddr ${raddrReplacement}`)
            sanitizedLines.push(sanitizedLine)
          } else {
            // Hostname candidate — use pre-resolved DNS result from parallel pass above.
            // Replacing hostname with resolved IP prevents WebRTC engine from re-resolving (DNS TOCTOU).
            const dnsResult = dnsResults.get(candidateAddr)
            if (!dnsResult) {
              console.error(`[volunteer] Dropping unresolvable hostname candidate from ${clientWallet}: ${candidateAddr}`)
              // Drop — do not push
              continue
            }
            const { resolved4, resolved6 } = dnsResult
            if (resolved4 && isPrivateIp(resolved4)) {
              console.error(`[volunteer] Dropping hostname with private IPv4 from ${clientWallet}: ${candidateAddr} → ${resolved4}`)
              candidateRejected = true
              break
            }
            if (resolved6 && isPrivateIp(resolved6)) {
              console.error(`[volunteer] Dropping hostname with private IPv6 from ${clientWallet}: ${candidateAddr} → ${resolved6}`)
              candidateRejected = true
              break
            }
            // Replace ALL occurrences of hostname with resolved IP to eliminate TOCTOU
            // re-resolution. String.replace replaces only the first match; replaceAll
            // ensures a crafted SDP that repeats the hostname elsewhere (e.g. in the
            // foundation field) cannot leave a surviving hostname for the WebRTC engine.
            const resolvedAddr = resolved4 ?? resolved6
            if (resolvedAddr) {
              sanitizedLines.push(line.replaceAll(candidateAddr, resolvedAddr))
            }
            // If neither resolved, silently drop (unresolvable hostname)
          }
        }
        if (candidateRejected) {
          if (peer !== mainPeer) { peer.close() }
          peers.delete(clientWallet)
          continue
        }
        const sanitizedAnswer: RTCSessionDescriptionInit = {
          type: answerDesc.type,
          sdp: sanitizedLines.join("\r\n"),
        }
        await peer.setRemoteDescription(sanitizedAnswer)
        console.log(`[volunteer] Handshake complete with ${clientWallet}`)
      } catch (err) {
        // Redact before logging — libwebrtc/wrtc error messages for ICE/SDP failures
        // can embed ICE candidate addresses, IP:port tuples, or SDP fragments.
        console.error(`[volunteer] setRemoteDescription failed for ${clientWallet}:`, redactErrMsg(err, config.rpcUrl))
        peers.delete(clientWallet)
      }
    }
    } finally {
      processRunning = false
    }
    schedulePoll()
  }

  schedulePoll()

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = () => {
    clearInterval(refreshInterval)
    if (pollTimer !== null) clearTimeout(pollTimer)
    for (const [, p] of peers) {
      try { p.close() } catch { /* ignore */ }
    }
    try { mainPeer.close() } catch { /* ignore */ }
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // Keep process alive
  await new Promise<never>(() => { /* never resolves */ })
}
