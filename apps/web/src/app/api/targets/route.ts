import { TARGETS, TARGETS_HASH } from '@resist/probe-node/src/probe'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { targets: TARGETS, hash: TARGETS_HASH },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
