import { NextRequest } from 'next/server'
import { TARGETS_HASH } from '@resist/probe-node/src/probe'

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
  // Multiple entries per URL create the per-URL health history visible in UrlHealthDrawer.
  return [
    // twitter.com — blocked at multiple timestamps from different nodes/regions
    { id: '1',  targetUrl: 'https://twitter.com', blockType: 'dns_poisoning',   geohash: 'u4pruyd', timestamp: now - 300_000,    nodeWallet: truncateWallet('0x0000000000000000000000000000000000000001'), reachable: false },
    { id: '1b', targetUrl: 'https://twitter.com', blockType: 'dns_poisoning',   geohash: 'tdr1w3j', timestamp: now - 900_000,    nodeWallet: truncateWallet('0x0000000000000000000000000000000000000002'), reachable: false },
    { id: '1c', targetUrl: 'https://twitter.com', blockType: null,              geohash: 'w3gv2uk', timestamp: now - 1_800_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000003'), reachable: true },
    { id: '1d', targetUrl: 'https://twitter.com', blockType: 'http_block',      geohash: 'sp7fj5n', timestamp: now - 3_600_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000004'), reachable: false },
    { id: '1e', targetUrl: 'https://twitter.com', blockType: 'dns_poisoning',   geohash: '9q5cs2r', timestamp: now - 7_200_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000005'), reachable: false },
    // instagram.com — blocked
    { id: '2',  targetUrl: 'https://instagram.com', blockType: 'http_block',    geohash: 'tdr1w3j', timestamp: now - 600_000,    nodeWallet: truncateWallet('0x0000000000000000000000000000000000000002'), reachable: false },
    { id: '2b', targetUrl: 'https://instagram.com', blockType: 'http_block',    geohash: 'u4pruyd', timestamp: now - 2_400_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000001'), reachable: false },
    { id: '2c', targetUrl: 'https://instagram.com', blockType: null,            geohash: 'w3gv2uk', timestamp: now - 5_400_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000003'), reachable: true },
    // wikipedia.org — mostly reachable
    { id: '3',  targetUrl: 'https://wikipedia.org', blockType: null,            geohash: 'w3gv2uk', timestamp: now - 900_000,    nodeWallet: truncateWallet('0x0000000000000000000000000000000000000003'), reachable: true },
    { id: '3b', targetUrl: 'https://wikipedia.org', blockType: null,            geohash: 'u4pruyd', timestamp: now - 2_700_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000001'), reachable: true },
    { id: '3c', targetUrl: 'https://wikipedia.org', blockType: 'tcp_rst',       geohash: 'sp7fj5n', timestamp: now - 5_100_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000004'), reachable: false },
    // youtube.com
    { id: '4',  targetUrl: 'https://youtube.com', blockType: 'tcp_rst',         geohash: 'sp7fj5n', timestamp: now - 1_200_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000004'), reachable: false },
    { id: '4b', targetUrl: 'https://youtube.com', blockType: 'tcp_rst',         geohash: 'tdr1w3j', timestamp: now - 4_200_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000002'), reachable: false },
    // reddit.com
    { id: '5',  targetUrl: 'https://reddit.com', blockType: 'full_unreachable', geohash: '9q5cs2r', timestamp: now - 1_800_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000005'), reachable: false },
    { id: '5b', targetUrl: 'https://reddit.com', blockType: null,               geohash: 'w3gv2uk', timestamp: now - 6_000_000,  nodeWallet: truncateWallet('0x0000000000000000000000000000000000000003'), reachable: true },
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
const GEOHASH_RE = /^[0-9bcdefghjkmnpqrstuvwxyz]{1,9}$/

function normalizeUrl(raw: string): string {
  try { return new URL(raw).href } catch { return raw }
}

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
    // Reject rows from probes that used a non-canonical target set. A probe
    // operator running a modified binary can embed any targetshash they like;
    // only rows whose stored hash matches the server-known canonical value are
    // served to the dashboard.
    const canonicalRows = rows.filter((r) => r.targetshash === TARGETS_HASH)
    return canonicalRows.map((r) => ({
      id: r.entityKey,
      targetUrl: r.targeturl,
      // Normalise blockType against known-good set — Arkiv rows written by adversarial
      // nodes could contain arbitrary strings; ensure only documented values reach clients.
      blockType: (r.blocktype && VALID_BLOCK_TYPES.has(r.blocktype) ? r.blocktype : null) as string | null,
      geohash: GEOHASH_RE.test(r.geohash ?? '') ? r.geohash : null,
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
  } catch (err) {
    console.error('[probe-events] queryArkivProbeEvents failed:', err)
    return null
  }
}

// Per-instance burst guard only: IP → { count, windowStart }
// Allows 60 requests per minute per IP within a single process.
// DOES NOT provide cross-instance rate limiting — on Vercel/Lambda each concurrent
// request may run in an isolated worker with its own empty map, so parallel requests
// from one IP bypass this entirely. This is intentionally kept as a within-instance
// burst guard only. Production deployments MUST add a distributed rate limiter at the
// edge (e.g. Vercel Edge Middleware + Upstash Redis, or Cloudflare Rate Limiting).
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
  const connIp = (request as any).ip ?? ''
  const validatedConn = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,39}$/.test(connIp) ? connIp : ''
  // In development/test, fall back to loopback so direct API calls (e.g. Playwright
  // request fixture) are not rejected. In production, the missing IP is a hard error.
  const devFallback = process.env['NODE_ENV'] === 'development' ? '127.0.0.1' : ''
  const ip = validatedConn || devFallback
  if (!ip) {
    return Response.json({ error: 'Bad Request: client IP could not be determined' }, { status: 400 })
  }
  // Skip rate limiting for loopback in development — all local/Playwright requests
  // share the same 127.0.0.1 IP and would otherwise exhaust the 60/min bucket
  // during a test run. In production the loopback fallback is never used.
  const isLoopback = ip === '127.0.0.1' || ip === '::1'
  if (!isLoopback && !checkRateLimit(ip)) {
    return Response.json({ error: 'Too Many Requests' }, {
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
  if (rawGeohash !== null && !GEOHASH_RE.test(rawGeohash)) {
    return new Response('Bad Request: invalid geohash', { status: 400 })
  }
  const geohashFilter = rawGeohash ?? undefined

  const rawTargetUrl = searchParams.get('targetUrl')
  let targetUrlFilter: string | undefined
  if (rawTargetUrl !== null) {
    try {
      const u = new URL(rawTargetUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol')
      targetUrlFilter = u.href
    } catch {
      return new Response('Bad Request: invalid targetUrl', { status: 400 })
    }
  }

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
        let events = await queryArkivProbeEvents({ limit: 2_000, since: Date.now() - 24 * 3600 * 1000, includeRawWallets: true })
        const arkivFailed = events === null
        const DEV_FIXTURE = getDevFixture()
        if (!events) events = DEV_FIXTURE ?? []
        const oneDayAgo = Date.now() - 24 * 3600 * 1000
        const recentAll = events.filter((e) => e.timestamp > oneDayAgo)
        // Quorum check: only count a URL as blocked when 3+ distinct geographic regions
        // (first 4 chars of geohash ≈ 45km cell) independently report it blocked.
        // Single-node reports are not counted — they may be fabricated by a malicious operator.
        // Require quorum-contributing wallets to have an active NodeIdentity heartbeat
        // that has been seen for at least 1 hour. This makes Sybil wallet creation
        // expensive: adversaries must run N legitimate nodes for ≥1h before fabricated
        // block reports from those wallets are counted toward blocksToday.
        let establishedWallets: Set<string> | null = null
        const rpcUrlForIdentity = process.env['ARKIV_RPC_URL']
        if (rpcUrlForIdentity) {
          try {
            const { ArkivReadClient: ArkivReadClientInner } = await import('@resist/arkiv-sdk/src/client.js')
            const identityClient = new ArkivReadClientInner(rpcUrlForIdentity)
            const identities = await identityClient.queryNodeIdentities()
            const oneHourAgo = Date.now() - 3600_000
            establishedWallets = new Set(
              identities
                .filter((id) => id.lastseenms > 0 && id.lastseenms > oneHourAgo)
                .map((id) => id.wallet)
            )
          } catch {
            // best-effort — if identity query fails, fall back to no wallet filter
          }
        }
        const blocksByUrl = new Map<string, Set<string>>()
        for (const e of recentAll) {
          if (e.blockType !== null && e.geohash && e.geohash.length >= 4) {
            if (establishedWallets !== null && !establishedWallets.has(e.nodeWallet)) continue
            const region = e.geohash.slice(0, 4)
            let regions = blocksByUrl.get(e.targetUrl)
            if (!regions) { regions = new Set(); blocksByUrl.set(e.targetUrl, regions) }
            regions.add(region)
          }
        }
        const BLOCK_QUORUM = 5
        const blocksToday = [...blocksByUrl.values()].filter(regions => regions.size >= BLOCK_QUORUM).length
        const regionSet = new Set(
          recentAll
            .filter((e) => e.geohash && e.geohash.length >= 4)
            .map((e) => e.geohash?.slice(0, 4))
        )
        // liveProbes uses raw wallets (includeRawWallets=true) so distinct-node
        // counting is exact — truncated wallets cause prefix/suffix collisions.
        // Apply the same establishedWallets filter used by blocksToday so the counter
        // is Sybil-resistant. rawActiveNodes exposes the unfiltered 24h count separately.
        const rawActiveNodes = new Set(recentAll.map((e) => e.nodeWallet)).size
        const liveProbes = establishedWallets !== null
          ? new Set(recentAll.filter((e) => establishedWallets!.has(e.nodeWallet)).map((e) => e.nodeWallet)).size
          : rawActiveNodes
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
      return Response.json({ error: 'Stats backend unavailable' }, { status: 503 })
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
  // Use dev fixture when the real query failed (null) OR when it returned empty and
  // we're in dev-fixture mode (no real data on-chain yet during development).
  if (!events || (USE_DEV_FIXTURE && events.length === 0)) {
    let fixture = DEV_FIXTURE ?? []
    // Apply filters to the dev fixture so tests that check blockType/geohash/targetUrl
    // filtering get the same behaviour as a real Arkiv-backed response.
    if (blockTypeFilter) fixture = fixture.filter(e => e.blockType === blockTypeFilter)
    if (geohashFilter) fixture = fixture.filter(e => e.geohash != null && e.geohash.startsWith(geohashFilter))
    if (targetUrlFilter) fixture = fixture.filter(e => normalizeUrl(e.targetUrl) === targetUrlFilter)
    events = fixture
  }

  // Apply targetUrl filter to real Arkiv results (Arkiv doesn't support this server-side).
  if (targetUrlFilter && events) {
    events = events.filter(e => normalizeUrl(e.targetUrl) === targetUrlFilter)
  }

  // Build quorum-verified URL set: a URL is verified when 5+ distinct 4-char geohash
  // regions (≈45km cells) independently report it blocked within the last 48h, AND
  // those reports come from established wallets (active NodeIdentity heartbeat ≥1h).
  // Single-node or unestablished block reports are labelled unverified.
  // NOTE: 'verified' is a probabilistic geographic-quorum heuristic, not a cryptographic
  // proof. An adversary controlling 5+ established wallets in different cities could
  // satisfy this threshold. The quorumStrength field in the response conveys this caveat.
  const BLOCK_QUORUM = 5
  let establishedWalletsForQuorum: Set<string> | null = null
  const rpcUrlForQuorum = process.env['ARKIV_RPC_URL']
  if (rpcUrlForQuorum) {
    try {
      const { ArkivReadClient: ArkivReadClientQuorum } = await import('@resist/arkiv-sdk/src/client.js')
      const identityClientQuorum = new ArkivReadClientQuorum(rpcUrlForQuorum)
      const identities = await identityClientQuorum.queryNodeIdentities()
      const oneHourAgo = Date.now() - 3600_000
      // Wallets in the events array are truncated (first 6 + last 4 chars with '…').
      // Truncate established wallet addresses the same way for matching.
      establishedWalletsForQuorum = new Set(
        identities
          .filter((id) => id.lastseenms > 0 && id.lastseenms > oneHourAgo)
          .map((id) => {
            const w = id.wallet
            return w.length > 10 ? w.slice(0, 6) + '…' + w.slice(-4) : w
          })
      )
    } catch {
      // best-effort — if identity query fails, fall back to no wallet filter
    }
  }
  const eventsForQuorum = events ?? []
  const quorumRegionsByUrl = new Map<string, Set<string>>()
  for (const e of eventsForQuorum) {
    if (e.blockType !== null && e.geohash && e.geohash.length >= 4) {
      if (establishedWalletsForQuorum !== null && !establishedWalletsForQuorum.has(e.nodeWallet)) continue
      const region = e.geohash!.slice(0, 4)
      let regions = quorumRegionsByUrl.get(e.targetUrl)
      if (!regions) { regions = new Set(); quorumRegionsByUrl.set(e.targetUrl, regions) }
      regions.add(region)
    }
  }
  const verifiedUrls = new Map(
    [...quorumRegionsByUrl.entries()]
      .filter(([, regions]) => regions.size >= BLOCK_QUORUM)
      .map(([url, regions]) => [url, regions.size] as [string, number])
  )

  // Strip events with non-http(s) targetUrl before sending to clients — a malicious
  // probe node could publish a javascript: or data: URL that gets rendered as a link.
  const safe = events.filter(e => {
    try {
      const u = new URL(e.targetUrl)
      return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      return false
    }
  }).map(e => ({
    ...e,
    // verified=true means quorum of 5+ distinct established-wallet regions corroborate
    // this block report. This is a probabilistic heuristic, not a cryptographic proof.
    verified: e.blockType === null ? true : verifiedUrls.has(e.targetUrl),
    // quorumStrength: number of distinct geographic regions that corroborate this URL
    // being blocked (0 if unverified). Signals confidence level to UI consumers.
    quorumStrength: e.blockType === null ? null : (verifiedUrls.get(e.targetUrl) ?? 0),
    verificationNote: 'geographic-quorum heuristic: not a cryptographic proof',
  }))

  const safeSlice = safe.slice(0, 200)

  // includeStats=true: piggyback cached stats onto the events response so the
  // client gets both in one request, eliminating the separate NodeCount poll.
  // Response shape: { events: [...], liveProbes, regions, blocksToday, volunteerCount }
  // Stats fields are null/absent when cache is cold (not yet computed).
  if (includeStats) {
    // Serve from cache when fresh.
    let cachedStats = (statsCache && statsCache.expiresAt > Date.now())
      ? statsCache.result as { liveProbes: number; regions: number; blocksToday: number; volunteerCount?: number }
      : null

    // When cache is cold in dev-fixture mode, return zero real stats — fixture
    // wallets are synthetic and should not inflate the "Online nodes" counter.
    if (!cachedStats && USE_DEV_FIXTURE) {
      cachedStats = { liveProbes: 0, regions: 0, blocksToday: 0, volunteerCount: 0 }
    }

    const statsFields = cachedStats
      ? { liveProbes: cachedStats.liveProbes, regions: cachedStats.regions, blocksToday: cachedStats.blocksToday, volunteerCount: cachedStats.volunteerCount ?? 0 }
      : null
    return Response.json({ events: safeSlice, ...(statsFields ?? {}) }, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' },
    })
  }

  return Response.json(safeSlice, {
    headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=30' },
  })
}
