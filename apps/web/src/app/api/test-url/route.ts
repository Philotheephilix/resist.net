import { NextRequest } from 'next/server'
import dns from 'dns/promises'
import net from 'net'
import { Agent } from 'undici'

const USE_DEV_FIXTURE = process.env['USE_MOCK_DATA'] === 'true' && process.env['NODE_ENV'] === 'development'

export interface TestUrlRequest {
  url: string
  method: 'HTTP' | 'DNS' | 'TCP'
}

export interface TestUrlResult {
  url: string
  method: 'HTTP' | 'DNS' | 'TCP'
  reachable: boolean | null
  statusCode?: number
  latencyMs?: number
  errorType?: 'dns_poisoning' | 'tcp_rst' | 'http_block' | 'full_unreachable' | null
  errorDetail?: string
  checkedAt: number
  region: string
  /** True when the requested probe method is not yet implemented server-side. */
  notSupported?: boolean
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const VALID_METHODS = new Set(['HTTP', 'DNS', 'TCP'])
const MAX_REDIRECTS = 3

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
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

function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    const [a, b] = parts
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 0) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a >= 224)
    )
  }
  if (net.isIPv6(ip)) {
    let canonical: string
    try {
      canonical = new URL(`http://[${ip}]`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    } catch {
      return true
    }
    const firstGroup = parseInt(canonical.split(':')[0] || '0', 16)
    const isLinkLocal = firstGroup >= 0xfe80 && firstGroup <= 0xfebf
    const isULA = firstGroup >= 0xfc00 && firstGroup <= 0xfdff
    const isMulticast = firstGroup >= 0xff00 && firstGroup <= 0xffff
    const isTeredo = canonical.startsWith('2001:0:') || (canonical.startsWith('2001:') && canonical.split(':')[1] === '0')
    const is6to4Private = /^2002:(0[0-9a-f][0-9a-f][0-9a-f]|ac1[0-9a-f]|c0a8):/i.test(canonical)
    return (
      canonical === '::1' ||
      canonical === '::' ||
      isULA ||
      isLinkLocal ||
      isMulticast ||
      isTeredo ||
      is6to4Private ||
      canonical.startsWith('::ffff:') ||
      canonical.startsWith('64:ff9b:') ||
      canonical.startsWith('0064:ff9b:') ||
      canonical.startsWith('100:') ||
      canonical.startsWith('2001:db8:') ||
      canonical.startsWith('2002:')
    )
  }
  return true
}

async function resolvePublicHostname(hostname: string): Promise<string> {
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new Error('Private/reserved IP address not allowed')
    return hostname
  }
  const { address } = await dns.lookup(hostname)
  if (isPrivateIP(address)) throw new Error('Hostname resolves to a private/reserved IP address')
  return address
}

// Dev fixture — returns a deterministic simulated result without making real
// outbound connections. Only active when USE_MOCK_DATA=true in development.
function devFixtureResult(url: string, method: string, region: string): TestUrlResult {
  const seed = url.length + url.charCodeAt(0)
  const reachable = seed % 3 !== 0
  const latencyMs = 80 + (seed % 400)
  let statusCode: number | undefined
  let errorType: TestUrlResult['errorType'] = null

  if (method === 'HTTP') {
    statusCode = reachable ? 200 : seed % 2 === 0 ? 403 : 503
    if (!reachable) errorType = seed % 2 === 0 ? 'http_block' : 'tcp_rst'
  } else if (method === 'DNS') {
    if (!reachable) errorType = 'dns_poisoning'
  } else {
    if (!reachable) errorType = seed % 2 === 0 ? 'tcp_rst' : 'full_unreachable'
  }

  return {
    url,
    method: method as TestUrlResult['method'],
    reachable,
    statusCode,
    latencyMs,
    errorType,
    errorDetail: reachable ? undefined : `Simulated ${errorType} for dev fixture`,
    checkedAt: Date.now(),
    region,
  }
}

async function probeHttpUrl(url: string, region: string): Promise<TestUrlResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    let currentUrl = url
    let redirectCount = 0
    let res: Response
    while (true) {
      const parsed = new URL(currentUrl)
      const resolvedIP = await resolvePublicHostname(parsed.hostname)
      const dispatcher = new Agent({
        connect: {
          lookup: (_hostname, _options, callback) => {
            callback(null, resolvedIP, net.isIPv6(resolvedIP) ? 6 : 4)
          },
        },
      })
      try {
        res = await fetch(currentUrl, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'manual',
          // @ts-expect-error undici dispatcher not in standard fetch types
          dispatcher,
        } as RequestInit)
      } finally {
        await dispatcher.destroy()
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) break
        if (location.length > 2048) break
        redirectCount++
        if (redirectCount > MAX_REDIRECTS) {
          return { url, method: 'HTTP', reachable: false, latencyMs: Date.now() - start, errorType: 'full_unreachable', errorDetail: 'Too many redirects', checkedAt: Date.now(), region }
        }
        const nextUrl = new URL(location, currentUrl).toString()
        if (!ALLOWED_PROTOCOLS.has(new URL(nextUrl).protocol)) break
        currentUrl = nextUrl
        continue
      }
      break
    }
    const latencyMs = Date.now() - start
    const reachable = res!.status < 400 || (res!.status >= 400 && res!.status < 500 && res!.status !== 403 && res!.status !== 451)
    let errorType: TestUrlResult['errorType'] = null
    if (res!.status === 403 || res!.status === 451) errorType = 'http_block'
    else if (!reachable) errorType = 'full_unreachable'
    return { url, method: 'HTTP', reachable, statusCode: res!.status, latencyMs, errorType, checkedAt: Date.now(), region }
  } catch (err) {
    const latencyMs = Date.now() - start
    const code = (err as NodeJS.ErrnoException).code
    let errorType: TestUrlResult['errorType'] = 'full_unreachable'
    let errorDetail: string = 'Connection failed'
    if (err instanceof Error && err.name === 'AbortError') {
      errorType = 'full_unreachable'
      errorDetail = 'Timed out'
    } else if (code === 'ENOTFOUND' || code === 'EAI_NONAME') {
      errorType = 'dns_poisoning'
      errorDetail = 'DNS lookup failed'
    } else if (code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      errorType = 'tcp_rst'
      errorDetail = 'Connection refused'
    } else if (code === 'ETIMEDOUT') {
      errorDetail = 'Timed out'
    } else if (err instanceof Error && err.message.toLowerCase().includes('certificate')) {
      errorDetail = 'TLS error'
    }
    return { url, method: 'HTTP', reachable: false, latencyMs, errorType, errorDetail, checkedAt: Date.now(), region }
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  const connIp = (request as any).ip ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
  const validatedConn = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$|^[0-9a-fA-F:]{2,39}$/.test(connIp) ? connIp : ''
  const devFallback = process.env['NODE_ENV'] === 'development' ? '127.0.0.1' : ''
  const ip = validatedConn || devFallback
  if (!ip) {
    return new Response('Bad Request: client IP could not be determined', { status: 400 })
  }
  const isLoopback = ip === '127.0.0.1' || ip === '::1'
  if (!isLoopback && !checkRateLimit(ip)) {
    return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '60' } })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }

  const { url, method = 'HTTP' } = body as Record<string, unknown>

  if (typeof url !== 'string' || !url.trim()) {
    return Response.json({ error: 'url is required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return Response.json({ error: 'url must be a valid absolute URL' }, { status: 400 })
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return Response.json({ error: 'url must use http or https' }, { status: 400 })
  }

  const methodStr = typeof method === 'string' ? method.toUpperCase() : 'HTTP'
  if (!VALID_METHODS.has(methodStr)) {
    return Response.json({ error: 'method must be HTTP, DNS, or TCP' }, { status: 400 })
  }

  const regionStr = 'Server'

  // Mock mode: return fixture without making real outbound requests
  if (USE_DEV_FIXTURE) {
    const result = devFixtureResult(parsed.href, methodStr, regionStr)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Production / non-mock: perform real probe (HTTP only for now; DNS/TCP require
  // server-side infrastructure that routes through volunteer nodes in production)
  if (methodStr === 'HTTP') {
    const result = await probeHttpUrl(parsed.href, regionStr)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  }

  // DNS and TCP probes require volunteer node infrastructure — not yet available
  // in this deployment tier. Return a meaningful error rather than silently failing.
  return Response.json(
    {
      url: parsed.href,
      method: methodStr,
      reachable: null,
      errorDetail: `${methodStr} probing requires volunteer node infrastructure (coming soon)`,
      checkedAt: Date.now(),
      region: regionStr,
      notSupported: true,
    },
    { status: 501 }
  )
}
