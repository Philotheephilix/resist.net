import { NextResponse } from 'next/server'

const KEY_ID = process.env['CLOUDFLARE_TURN_KEY_ID']
const API_TOKEN = process.env['CLOUDFLARE_TURN_API_TOKEN']

// Cache credentials until 60s before expiry to avoid hammering Cloudflare.
let cached: { iceServers: object[]; expiresAt: number } | null = null

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!KEY_ID || !API_TOKEN) {
    return NextResponse.json({ error: 'TURN not configured' }, { status: 503 })
  }

  const now = Date.now()
  if (cached && cached.expiresAt > now + 60_000) {
    return NextResponse.json({ iceServers: cached.iceServers })
  }

  const TTL = 86400 // 24h
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: TTL }),
      }
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[turn-credentials] Cloudflare error', res.status, text.slice(0, 200))
      return NextResponse.json({ error: 'Cloudflare TURN request failed' }, { status: 502 })
    }
    const data = await res.json() as { iceServers: object[] }
    if (!Array.isArray(data.iceServers)) {
      return NextResponse.json({ error: 'Bad Cloudflare response' }, { status: 502 })
    }
    cached = { iceServers: data.iceServers, expiresAt: now + TTL * 1000 }
    return NextResponse.json({ iceServers: data.iceServers })
  } catch (err) {
    console.error('[turn-credentials]', err)
    return NextResponse.json({ error: 'Failed to fetch TURN credentials' }, { status: 500 })
  }
}
