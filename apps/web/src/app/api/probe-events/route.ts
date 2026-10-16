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
  if (!rpcUrl) return null

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
      geohash: r.geohash,
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
        const oldest = [...rateLimitMap.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart)[0]
        if (oldest) rateLimitMap.delete(oldest[0])
      }
    }
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-real-ip') ?? '127.0.0.1'
  if (!checkRateLimit(ip)) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  }

  const { searchParams } = new URL(request.url)
  const statsMode = searchParams.get('stats') === 'true'
  const rawBlockType = searchParams.get('blockType')
  if (rawBlockType !== null && !VALID_BLOCK_TYPES.has(rawBlockType)) {
    return new Response('Bad Request: invalid blockType', { status: 400 })
  }
  const blockTypeFilter = rawBlockType ?? undefined
  const rawGeohash = searchParams.get('geohash')
  if (rawGeohash !== null && !/^[a-z0-9]{1,9}$/.test(rawGeohash)) {
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
        const statsResult = { liveProbes, regions: regionSet.size, blocksToday }
        // Only cache from a real Arkiv response — zeros from a failed Arkiv would
        // mask recovery for up to 60 seconds.
        // Only cache on a real Arkiv success. Caching with DEV_FIXTURE when Arkiv
        // failed would mask recovery for up to 60s in dev, since the cache check
        // at line 103 returns early without querying Arkiv on subsequent requests.
        if (!arkivFailed) {
          statsCache = { result: statsResult, expiresAt: Date.now() + 60_000 }
        }
        return statsResult
      })().finally(() => { statsInFlight = null })
    }
    const statsResult = await statsInFlight
    return Response.json(statsResult, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=30' },
    })
  }

  // For normal (map/list) queries, push geohash and blockType filters to Arkiv
  // so the server-side query only returns matching rows.
  let events = await queryArkivProbeEvents({
    geohash: geohashFilter,
    blockType: blockTypeFilter,
    limit: 200,
    includeRawWallets: false,
  })
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

  return Response.json(safe.slice(0, 200), {
    headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' },
  })
}
