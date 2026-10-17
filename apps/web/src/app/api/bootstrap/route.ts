import { NextRequest } from 'next/server'

// WARNING (deployment): rateLimitMap is process-scoped. On Vercel/Lambda each
// concurrent invocation is an isolated process — an attacker can bypass the 120 req/min
// limit by triggering parallel cold starts. For production, add a distributed rate
// limiter (e.g. Vercel Edge Middleware + Upstash Redis, or Cloudflare Rate Limiting)
// that shares state across instances. This map remains as a secondary defence for
// within-instance burst traffic.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 120
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
  const devFallback = process.env['NODE_ENV'] === 'development' ? '127.0.0.1' : ''
  const ip = validatedRaw || validatedConn || devFallback
  if (!ip) {
    return new Response('Bad Request: client IP could not be determined', { status: 400 })
  }
  const isLoopback = ip === '127.0.0.1' || ip === '::1'
  if (!isLoopback && !checkRateLimit(ip)) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    })
  }

  const rpcUrl = process.env['ARKIV_RPC_URL']

  if (!rpcUrl) {
    if (process.env['NODE_ENV'] !== 'development') {
      return Response.json({ error: 'ARKIV_RPC_URL not configured' }, { status: 503 })
    }
    return Response.json([])
  }

  try {
    const { ArkivReadClient } = await import('@resist/arkiv-sdk/src/client.js')
    const client = new ArkivReadClient(rpcUrl)
    const volunteers = await client.queryVolunteers()

    const entries = volunteers
      .filter((v) => typeof v.sdpoffer === 'string' && v.sdpoffer.length <= 131072)
      .slice(0, 50)
      .map((v) => ({
        wallet: v.wallet.length > 10 ? v.wallet.slice(0, 6) + '…' + v.wallet.slice(-4) : v.wallet,
        geohash: v.geohash ? v.geohash.slice(0, 5) : v.geohash,
        capacitySlots: v.capacityslots,
        createdAt: v.createdat,
        sdpOffer: v.sdpoffer,
      }))

    return Response.json(entries)
  } catch {
    return Response.json([])
  }
}
