import { NextRequest } from 'next/server'
import dns from 'dns/promises'
import net from 'net'

export interface TestUrlRequest {
  url: string
  method: 'HTTP' | 'DNS' | 'TCP'
  region?: string
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
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase()
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80') ||
      normalized === '::' ||
      normalized.startsWith('::ffff:') ||
      normalized.startsWith('64:ff9b:') ||
      normalized.startsWith('0064:ff9b:') ||
      normalized.startsWith('100:') ||
      normalized.startsWith('2001:db8:') ||
      normalized.startsWith('2002:')
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
    const parsed = new URL(url)
    const resolvedIP = await resolvePublicHostname(parsed.hostname)
    const fetchUrl = new URL(url)
    fetchUrl.hostname = net.isIPv6(resolvedIP) ? `[${resolvedIP}]` : resolvedIP
    const res = await fetch(fetchUrl.toString(), {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { Host: parsed.host },
    })
    if (res.redirected) {
      const redirectedHost = new URL(res.url).hostname
      await resolvePublicHostname(redirectedHost)
    }
    const latencyMs = Date.now() - start
    const reachable = res.status < 500
    let errorType: TestUrlResult['errorType'] = null
    if (!reachable) {
      errorType = res.status === 403 || res.status === 451 ? 'http_block' : 'full_unreachable'
    }
    return { url, method: 'HTTP', reachable, statusCode: res.status, latencyMs, errorType, checkedAt: Date.now(), region }
  } catch (err) {
    const latencyMs = Date.now() - start
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as NodeJS.ErrnoException).code
    let errorType: TestUrlResult['errorType'] = 'full_unreachable'
    if (err instanceof Error && err.name === 'AbortError') {
      errorType = 'full_unreachable'
    } else if (code === 'ENOTFOUND' || code === 'EAI_NONAME') {
      errorType = 'dns_poisoning'
    } else if (code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      errorType = 'tcp_rst'
    }
    return { url, method: 'HTTP', reachable: false, latencyMs, errorType, errorDetail: msg, checkedAt: Date.now(), region }
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Body must be a JSON object' }, { status: 400 })
  }

  const { url, method = 'HTTP', region = 'Auto' } = body as Record<string, unknown>

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

  const regionStr = typeof region === 'string' && region.trim() ? region.trim() : 'Auto'
  if (regionStr.length > 128) return Response.json({ error: 'region too long' }, { status: 400 })

  // Mock mode: return fixture without making real outbound requests
  if (process.env['USE_MOCK_DATA'] === 'true' && process.env['NODE_ENV'] !== 'production') {
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
