import { NextRequest } from 'next/server'

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

  const rpcUrl = process.env['ARKIV_RPC_URL']

  if (!rpcUrl) {
    return Response.json([])
  }

  try {
    const { ArkivReadClient } = await import('@resist/arkiv-sdk/src/client.js')
    const client = new ArkivReadClient(rpcUrl)
    const volunteers = await client.queryVolunteers()

    const entries = volunteers.map((v) => ({
      wallet: v.wallet.length > 10 ? v.wallet.slice(0, 6) + '…' + v.wallet.slice(-4) : v.wallet,
      geohash: v.geohash ? v.geohash.slice(0, 5) : v.geohash,
      capacitySlots: v.capacityslots,
      createdAt: v.createdat,
    }))

    return Response.json(entries)
  } catch {
    return Response.json([])
  }
}
