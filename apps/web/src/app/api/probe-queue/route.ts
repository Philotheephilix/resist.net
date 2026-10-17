import { NextRequest, NextResponse } from 'next/server'
import { ArkivReadClient } from '@resist/arkiv-sdk/src/client.js'

const rpcUrl = process.env['ARKIV_RPC_URL'] ?? ''

export async function GET(req: NextRequest) {
  if (!rpcUrl) {
    return NextResponse.json({ error: 'ARKIV_RPC_URL not configured' }, { status: 503 })
  }
  const since = req.nextUrl.searchParams.get('since')
  try {
    const client = new ArkivReadClient(rpcUrl)
    const entries = await client.queryProbeQueue({
      limit: 50,
      since: since ? Number(since) : undefined,
    })
    return NextResponse.json(entries)
  } catch (err) {
    console.error('[probe-queue GET]', err)
    return NextResponse.json({ error: 'Failed to query probe queue' }, { status: 500 })
  }
}

export interface ProbeQueueSubmitBody {
  targetUrl: string
  volunteerCount: number
  repeatCount: number
  intervalSeconds: number
  paymentGlm: number
  requesterWallet: string
}

export async function POST(req: NextRequest) {
  if (!rpcUrl) {
    return NextResponse.json({ error: 'ARKIV_RPC_URL not configured' }, { status: 503 })
  }

  let body: ProbeQueueSubmitBody
  try {
    body = (await req.json()) as ProbeQueueSubmitBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { targetUrl, volunteerCount, repeatCount, intervalSeconds, paymentGlm, requesterWallet } = body

  if (!targetUrl || typeof targetUrl !== 'string') {
    return NextResponse.json({ error: 'targetUrl required' }, { status: 400 })
  }
  let parsedUrl: URL
  try {
    parsedUrl = new URL(targetUrl)
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('protocol')
    }
  } catch {
    return NextResponse.json({ error: 'targetUrl must be a valid http/https URL' }, { status: 400 })
  }

  if (!requesterWallet || typeof requesterWallet !== 'string') {
    return NextResponse.json({ error: 'requesterWallet required' }, { status: 400 })
  }

  const vc = Math.max(1, Math.min(Number(volunteerCount) || 1, 20))
  const rc = Math.max(1, Math.min(Number(repeatCount) || 1, 10))
  const is = Math.max(30, Math.min(Number(intervalSeconds) || 60, 3600))
  const glm = Math.max(0.001, Math.min(Number(paymentGlm) || 0.1, 100))

  const now = Date.now()
  const expiresAt = now + Math.max(rc * is * 2, 3600) * 1000

  // Write using the signing key from env (server-side only)
  const privateKey = process.env['DEV_PRIVATE_KEY']
  if (!privateKey) {
    return NextResponse.json({ error: 'Server signing key not configured' }, { status: 503 })
  }

  try {
    const { ArkivClient } = await import('@resist/arkiv-sdk/src/client.js')
    const client = new ArkivClient({
      rpcUrl,
      privateKey: privateKey as `0x${string}`,
      canonicalTargetsHash: '',
    })
    const entityKey = await client.writeProbeQueueEntry({
      requesterWallet,
      targetUrl: parsedUrl.href,
      volunteerCount: vc,
      repeatCount: rc,
      intervalSeconds: is,
      paymentGlm: glm,
      createdAt: now,
      expiresAt,
    })
    return NextResponse.json({ entityKey, expiresAt })
  } catch (err) {
    console.error('[probe-queue POST]', err)
    return NextResponse.json({ error: 'Failed to submit probe job' }, { status: 500 })
  }
}
