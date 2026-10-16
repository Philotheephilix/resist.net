import { NextRequest } from 'next/server'

// Dev fixture — only served when NODE_ENV=development and USE_MOCK_DATA=true.
// Never served in production; never substitute for real Arkiv data.
// Timestamps are computed lazily at request time so fixtures never age past
// the oneDayAgo filter regardless of how long the process has been running.
const USE_DEV_FIXTURE = process.env['NODE_ENV'] === 'development' && process.env['USE_MOCK_DATA'] === 'true'

function truncateWallet(w: string): string {
  return w.length > 10 ? w.slice(0, 6) + '…' + w.slice(-4) : w
}

function getDevFixture() {
  if (!USE_DEV_FIXTURE) return null
  const now = Date.now()
  // Wallet addresses pre-truncated to match the truncation applied to real Arkiv data
  // in queryArkivProbeEvents. Ensures the fixture path can never leak full addresses.
  return [
    { id: '1', targetUrl: 'https://twitter.com', blockType: 'dns_poisoning', geohash: 'u4pruyd', timestamp: now - 300_000, nodeWallet: truncateWallet('0x0000000000000000000000000000000000000001'), reachable: false },
    { id: '2', targetUrl: 'https://instagram.com', blockType: 'http_block', geohash: 'tdr1w3j', timestamp: now - 600_000, nodeWallet: truncateWallet('0x0000000000000000000000000000000000000002'), reachable: false },
    { id: '3', targetUrl: 'https://wikipedia.org', blockType: null, geohash: 'w3gv2uk', timestamp: now - 900_000, nodeWallet: truncateWallet('0x0000000000000000000000000000000000000003'), reachable: true },
    { id: '4', targetUrl: 'https://youtube.com', blockType: 'tcp_rst', geohash: 'sp7fj5n', timestamp: now - 1_200_000, nodeWallet: truncateWallet('0x0000000000000000000000000000000000000004'), reachable: false },
    { id: '5', targetUrl: 'https://reddit.com', blockType: 'full_unreachable', geohash: '9q5cs2r', timestamp: now - 1_800_000, nodeWallet: truncateWallet('0x0000000000000000000000000000000000000005'), reachable: false },
  ]
}

// Stats cache with 60s TTL. Checked BEFORE calling queryArkivProbeEvents so the
// expensive 10,000-row Arkiv query is genuinely skipped on cache hits.
// Process-scoped — each serverless cold-start begins with a cache miss, which is
// acceptable: the first poll pays the full cost, subsequent polls within the same
// warm worker are served from cache.
let statsCache: { result: object; expiresAt: number } | null = null
// Singleflight: coalesce concurrent cold-start requests onto one Arkiv query.
// Without this, N concurrent requests on a cold serverless worker each issue
// their own 2000-row query — the thundering herd fully avoids the empty cache.
let statsInFlight: Promise<object> | null = null

const VALID_BLOCK_TYPES = new Set(['dns_poisoning', 'tcp_rst', 'http_block', 'full_unreachable'])

async function queryArkivProbeEvents(opts: {
  geohash?: string
  blockType?: string
  since?: number
  limit?: number
  includeRawWallets?: boolean
}) {
  const rpcUrl = process.env['ARKIV_RPC_URL']
  if (!rpcUrl) {
    if (process.env['NODE_ENV'] !== 'development') {
      throw new Error('ARKIV_RPC_URL not configured')
    }
    return null
  }

  try {
    const { ArkivReadClient } = await import('@resist/arkiv-sdk/src/client.js')
    const client = new ArkivReadClient(rpcUrl)
    const rows = await client.queryProbeResults({
      geohashPrefix: opts.geohash,
      blockType: opts.blockType,
      since: opts.since ?? Date.now() - 48 * 3600 * 1000,
      limit: opts.limit ?? 200,
    })
    return rows.map((r) => ({
      id: r.entityKey,
      targetUrl: r.targeturl,
      // Normalise blockType against known-good set — Arkiv rows written by adversarial
      // nodes could contain arbitrary strings; ensure only documented values reach clients.
      blockType: (r.blocktype && VALID_BLOCK_TYPES.has(r.blocktype) ? r.blocktype : null) as string | null,
      geohash: /^[0-9bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(r.geohash ?? '') ? r.geohash : null,
      timestamp: r.timestamp,
      // Stats queries receive the raw wallet so distinct-node counting is accurate.
      // Non-stats (map/list) queries receive truncated wallets to prevent operator
      // de-anonymization by correlating with on-chain transactions.
      nodeWallet: opts.includeRawWallets
        ? r.nodewallet
        : (r.nodewallet.length > 10
            ? r.nodewallet.slice(0, 6) + '…' + r.nodewallet.slice(-4)
            : r.nodewallet),
      reachable: r.reachable,
    }))
  } catch {
    return null
  }
}

// In-memory rate limiter: IP → { count, windowStart }
// Allows 60 requests per minute per IP. Process-scoped — resets on cold starts
// (acceptable: cold starts are rare and the window resets quickly).
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()

const RATE_LIMIT_MAP_MAX = 100_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
      for (const [k, v] of rateLimitMap) {
        if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) {
          rateLimitMap.delete(k)
          if (rateLimitMap.size < RATE_LIMIT_MAP_MAX) break
        }
      }
      if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX) {
        const oldestKey = rateLimitMap.keys().next().value
        if (oldestKey !== undefined) rateLimitMap.delete(oldestKey)
      }
    }
    rateLimitMap.delete(ip)
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

export async function GET(request: NextRequest) {
  const rawIp = (request.headers.get('x-real-ip') ?? '').slice(0, 45).trim()
  const connIp = (request as any).ip ?? ''
  const validatedRaw = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$/.test(rawIp) ? rawIp : ''
  const validatedConn = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$/.test(connIp) ? connIp : ''
  // In development/test, fall back to loopback so direct API calls (e.g. Playwright
  // request fixture) are not rejected. In production, the missing IP is a hard error.
  const devFallback = process.env['NODE_ENV'] === 'development' ? '127.0.0.1' : ''
  const ip = validatedRaw || validatedConn || devFallback
  if (!ip) {
    return new Response('Bad Request: client IP could not be determined', { status: 400 })
  }
  if (!checkRateLimit(ip)) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  }

  const { searchParams } = new URL(request.url)
  const statsMode = searchParams.get('stats') === 'true'
  // includeStats=true: piggyback cached stats onto the events response so callers
  // do not need a separate polling interval for stats. Eliminates the duplicate
  // /api/probe-events?stats=true request that NodeCount used to fire independently.
  const includeStats = searchParams.get('includeStats') === 'true'
  const rawBlockType = searchParams.get('blockType')
  if (rawBlockType !== null && !VALID_BLOCK_TYPES.has(rawBlockType)) {
    return new Response('Bad Request: invalid blockType', { status: 400 })
  }
  const blockTypeFilter = rawBlockType ?? undefined
  const rawGeohash = searchParams.get('geohash')
  // Valid geohash base32 chars exclude a, i, l, o (to avoid confusion with 0/1).
  // The previous regex [0-9bcdefghjkmnpqrstuvwxyz] already excluded them but lacked
  // anchoring; {1,9} and ^ $ ensure no extra chars slip through either side.
  if (rawGeohash !== null && !/^[0-9bcdefghjkmnpqrstuvwxyz]{1,9}$/.test(rawGeohash)) {
    return new Response('Bad Request: invalid geohash', { status: 400 })
  }
  const geohashFilter = rawGeohash ?? undefined

  // stats=true + geohash=X would silently return geohash-scoped stats, which
  // NodeCount and the global dashboard expect to be global. Reject the combo.
  if (statsMode && geohashFilter) {
    return new Response('Bad Request: stats=true cannot be combined with geohash', { status: 400 })
  }

  // Return cached stats BEFORE issuing the expensive 2000-row Arkiv query.
  // The cache check must come first — placing it after the query means every
  // request pays the full RPC cost regardless of cache state.
  if (statsMode && statsCache && statsCache.expiresAt > Date.now()) {
    return Response.json(statsCache.result, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' },
    })
  }

  if (statsMode) {
    // Singleflight: if a stats query is already in-flight, join it rather than
    // issuing a second 2000-row Arkiv query. Prevents thundering-herd stampede
    // on cold-start where N concurrent requests all race past the empty cache.
    if (!statsInFlight) {
      statsInFlight = (async () => {
        let events = await queryArkivProbeEvents({ limit: 2_000, includeRawWallets: true })
        const arkivFailed = events === null
        const DEV_FIXTURE = getDevFixture()
        if (!events) events = DEV_FIXTURE ?? []
        const oneDayAgo = Date.now() - 24 * 3600 * 1000
        const recentAll = events.filter((e) => e.timestamp > oneDayAgo)
        const blocksToday = recentAll.filter((e) => e.blockType !== null).length
        const regionSet = new Set(
          recentAll
            .filter((e) => e.geohash && e.geohash.length >= 4)
            .map((e) => e.geohash.slice(0, 4))
        )
        // liveProbes uses raw wallets (includeRawWallets=true) so distinct-node
        // counting is exact — truncated wallets cause prefix/suffix collisions.
        const liveProbes = new Set(recentAll.map((e) => e.nodeWallet)).size
        // Fetch volunteer count alongside probe stats so VolunteerCount can share
        // this polling interval instead of running its own independent 120s loop.
        let volunteerCount = 0
        const rpcUrl = process.env['ARKIV_RPC_URL']
        if (rpcUrl) {
          try {
            const { ArkivReadClient } = await import('@resist/arkiv-sdk/src/client.js')
            const client = new ArkivReadClient(rpcUrl)
            const volunteers = await client.queryVolunteers()
            volunteerCount = volunteers.length
          } catch {
            // best-effort — leave volunteerCount at 0
          }
        } else if (USE_DEV_FIXTURE) {
          volunteerCount = 3
        }

        const statsResult = { liveProbes, regions: regionSet.size, blocksToday, volunteerCount }
        // Only cache from a real Arkiv response — zeros from a failed Arkiv would
        // mask recovery for up to 60 seconds.
        if (!arkivFailed) {
          statsCache = { result: statsResult, expiresAt: Date.now() + 60_000 }
        }
        return statsResult
      })().finally(() => { statsInFlight = null })
      // Attach a no-op rejection handler so Node doesn't emit an
      // UnhandledPromiseRejectionWarning if the caller abandons statsInFlight
      // (e.g. the request is aborted) before the promise settles.
      statsInFlight.catch(() => { /* rejection handled by each awaiter below */ })
    }
    let statsResult
    try {
      statsResult = await statsInFlight
    } catch (err) {
      if (err instanceof Error && err.message === 'ARKIV_RPC_URL not configured') {
        return Response.json({ error: 'ARKIV_RPC_URL not configured' }, { status: 503 })
      }
      return Response.json(
        { liveProbes: 0, regions: 0, blocksToday: 0, volunteerCount: 0 },
        { status: 200 },
      )
    }
    return Response.json(statsResult, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' },
    })
  }

  // For normal (map/list) queries, push geohash and blockType filters to Arkiv
  // so the server-side query only returns matching rows.
  let events: Awaited<ReturnType<typeof queryArkivProbeEvents>>
  try {
    events = await queryArkivProbeEvents({
      geohash: geohashFilter,
      blockType: blockTypeFilter,
      limit: 200,
      includeRawWallets: false,
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'ARKIV_RPC_URL not configured') {
      return Response.json({ error: 'ARKIV_RPC_URL not configured' }, { status: 503 })
    }
    events = null
  }
  const DEV_FIXTURE = getDevFixture()
  if (!events) events = DEV_FIXTURE ?? []

  // Strip events with non-http(s) targetUrl before sending to clients — a malicious
  // probe node could publish a javascript: or data: URL that gets rendered as a link.
  const safe = events.filter(e => {
    try {
      const u = new URL(e.targetUrl)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  })

  const safeSlice = safe.slice(0, 200)

  // includeStats=true: piggyback cached stats onto the events response so the
  // client gets both in one request, eliminating the separate NodeCount poll.
  if (includeStats) {
    // Serve from cache when fresh; otherwise return null stats so the client
    // renders stale stats rather than blocking on a second Arkiv query.
    const stats = (statsCache && statsCache.expiresAt > Date.now())
      ? statsCache.result
      : null
    return Response.json({ events: safeSlice, stats }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' },
    })
  }

  return Response.json(safeSlice, {
    headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' },
  })
}
