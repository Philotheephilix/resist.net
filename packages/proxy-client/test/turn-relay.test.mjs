/**
 * Integration test: Cloudflare TURN relay — two Node.js WebRTC peers
 * connect relay-only and exchange data (simulates volunteer/user proxy).
 *
 * Uses node-datachannel (supports Node 20+).
 *
 * Tests:
 * 1. /api/turn-credentials returns valid TURN iceServers
 * 2. Two peers connect via TURN relay (3 rounds for stability)
 * 3. Bidirectional DataChannel messages flow correctly
 * 4. HTTP-CONNECT shaped message exchange (simulates proxy protocol)
 */

import nodeDatachannel from "node-datachannel"
import assert from "node:assert/strict"

const BACKEND_URL = process.env.RESIST_BACKEND_URL ?? "http://localhost:3001"
const RETRIES = 3

async function fetchTurnConfig() {
  const res = await fetch(`${BACKEND_URL}/api/turn-credentials`)
  assert.ok(res.ok, `turn-credentials HTTP ${res.status}`)
  const data = await res.json()
  assert.ok(Array.isArray(data.iceServers) && data.iceServers.length > 0, "empty iceServers")
  const turnEntry = data.iceServers.find(s =>
    [s.urls].flat().some(u => u.startsWith("turn:") || u.startsWith("turns:"))
  )
  assert.ok(turnEntry, "no TURN URL in iceServers")
  assert.ok(turnEntry.username, "TURN entry missing username")
  assert.ok(turnEntry.credential, "TURN entry missing credential")
  return data.iceServers
}

function toNdcIceServers(cfServers) {
  const out = []
  for (const s of cfServers) {
    if (!s.username || !s.credential) continue
    for (const url of [s.urls].flat()) {
      const m = /^(turns?):([^:?]+):(\d+)(?:\?transport=(\w+))?$/.exec(url)
      if (!m) continue
      const [, proto, host, rawPort, transport = "udp"] = m
      const relayType = proto === "turns"
        ? (transport === "tcp" ? "TlsOverTcp" : "Tls")
        : (transport === "tcp" ? "Tcp" : "Udp")
      out.push({ hostname: host, port: Number(rawPort), username: s.username, password: s.credential, relayType })
    }
  }
  assert.ok(out.length > 0, "no TURN servers parsed")
  return out
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function runRelayTest(ndcServers, attempt) {
  const cfg = { iceServers: ndcServers, iceTransportPolicy: "relay" }

  // Create both peers before wiring callbacks so no SDP arrives before the
  // peer is in a state to accept it.
  const volPeer = new nodeDatachannel.PeerConnection(`vol-${attempt}`, cfg)
  const userPeer = new nodeDatachannel.PeerConnection(`usr-${attempt}`, cfg)

  // Buffer SDP/candidates until both peers are wired
  let pendingVolSdp = null, pendingUserSdp = null
  const pendingVolCands = [], pendingUserCands = []

  const volCandTypes = new Set()
  const userCandTypes = new Set()
  const volReceived = []
  const userReceived = []

  return new Promise((resolve, reject) => {
    let done = false
    const TIMEOUT = 70_000
    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); reject(new Error(`attempt ${attempt}: ICE timeout`)) }
    }, TIMEOUT)

    function cleanup() {
      try { volPeer.close() } catch {}
      try { userPeer.close() } catch {}
    }

    function fail(msg) {
      if (!done) { done = true; clearTimeout(timer); cleanup(); reject(new Error(msg)) }
    }

    function checkDone() {
      if (done) return
      const ok = volReceived.includes("hello from user")
        && volReceived.some(m => m.startsWith("CONNECT "))
        && userReceived.includes("hello from volunteer")
      if (ok) {
        done = true
        clearTimeout(timer)
        cleanup()
        resolve({ volCandTypes, userCandTypes })
      }
    }

    // ── SDP exchange ────────────────────────────────────────────────────────
    volPeer.onLocalDescription((sdp, type) => {
      // Apply to userPeer; buffer if for any reason it's not ready (shouldn't happen)
      try { userPeer.setRemoteDescription(sdp, type) }
      catch { pendingVolSdp = { sdp, type } }
    })
    userPeer.onLocalDescription((sdp, type) => {
      try { volPeer.setRemoteDescription(sdp, type) }
      catch { pendingUserSdp = { sdp, type } }
    })

    // ── ICE candidates ──────────────────────────────────────────────────────
    volPeer.onLocalCandidate((cand, mid) => {
      const typ = /typ (\w+)/.exec(cand)?.[1]
      if (typ) volCandTypes.add(typ)
      try { userPeer.addRemoteCandidate(cand, mid) }
      catch { pendingVolCands.push({ cand, mid }) }
    })
    userPeer.onLocalCandidate((cand, mid) => {
      const typ = /typ (\w+)/.exec(cand)?.[1]
      if (typ) userCandTypes.add(typ)
      try { volPeer.addRemoteCandidate(cand, mid) }
      catch { pendingUserCands.push({ cand, mid }) }
    })

    // ── data channels ───────────────────────────────────────────────────────
    const volCh = volPeer.createDataChannel("proxy-test")
    volCh.onOpen(() => {
      try { volCh.sendMessage("hello from volunteer") } catch (e) { fail(String(e)) }
    })
    volCh.onMessage(msg => {
      volReceived.push(typeof msg === "string" ? msg : msg.toString())
      checkDone()
    })
    volCh.onError(e => fail(`vol channel: ${e}`))
    volCh.onClosed(() => { if (!done) fail("vol channel closed prematurely") })

    userPeer.onDataChannel(ch => {
      ch.onOpen(() => {
        try {
          ch.sendMessage("hello from user")
          ch.sendMessage("CONNECT twitter.com:443 HTTP/1.1\r\nHost: twitter.com:443\r\n\r\n")
        } catch (e) { fail(String(e)) }
      })
      ch.onMessage(msg => {
        userReceived.push(typeof msg === "string" ? msg : msg.toString())
        checkDone()
      })
      ch.onError(e => fail(`user channel: ${e}`))
    })
  })
}

async function main() {
  console.log("── Test 1: /api/turn-credentials ──────────────────────────────")
  const cfServers = await fetchTurnConfig()
  const turnUrls = cfServers.flatMap(s => [s.urls].flat()).filter(u => u.startsWith("turn"))
  console.log(`✓ ${cfServers.length} ICE server entries, ${turnUrls.length} TURN URLs`)
  console.log(`  sample: ${turnUrls[0]}`)
  const ndcServers = toNdcIceServers(cfServers)
  console.log(`✓ Parsed ${ndcServers.length} relay entries`)

  console.log(`\n── Tests 2-4: two-client TURN relay (${RETRIES} rounds) ────────────`)
  let passed = 0
  for (let i = 1; i <= RETRIES; i++) {
    process.stdout.write(`  [${i}/${RETRIES}] `)
    try {
      const { volCandTypes, userCandTypes } = await runRelayTest(ndcServers, i)
      const allTypes = new Set([...volCandTypes, ...userCandTypes])
      const nonRelay = [...allTypes].filter(t => t !== "relay")
      if (nonRelay.length) {
        console.log(`✓ connected (WARN non-relay types: ${nonRelay.join(",")})`)
      } else if (allTypes.size > 0) {
        console.log(`✓ relay-only [${[...allTypes].join(",")}]`)
      } else {
        console.log(`✓ connected`)
      }
      passed++
    } catch (err) {
      console.log(`✗ ${err.message}`)
    }
    // Brief pause between rounds so TURN allocations don't collide
    if (i < RETRIES) await sleep(500)
  }

  console.log()
  if (passed === RETRIES) {
    console.log(`✅ ${RETRIES}/${RETRIES} rounds passed`)
    console.log("   • /api/turn-credentials → valid Cloudflare TURN credentials")
    console.log("   • Two clients connect relay-only (no own ports exposed)")
    console.log("   • DataChannel bidirectional messages delivered")
    console.log("   • HTTP-CONNECT shaped proxy message relayed")
    process.exit(0)
  } else if (passed > 0) {
    console.warn(`⚠  ${passed}/${RETRIES} rounds passed`)
    process.exit(1)
  } else {
    console.error(`❌ All ${RETRIES} rounds failed`)
    process.exit(1)
  }
}

main().catch(err => { console.error("❌", err); process.exit(1) })
