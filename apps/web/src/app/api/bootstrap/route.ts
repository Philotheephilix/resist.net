import { NextRequest } from 'next/server'

export async function GET(_request: NextRequest) {
  const rpcUrl = process.env['ARKIV_RPC_URL']

  if (!rpcUrl) {
    return Response.json([])
  }

  try {
    const { ArkivReadClient } = await import('@resist/arkiv-sdk/src/client.js')
    const client = new ArkivReadClient(rpcUrl)
    const volunteers = await client.queryVolunteers()

    const entries = volunteers.map((v) => ({
      wallet: v.wallet,
      geohash: v.geohash,
      capacitySlots: v.capacityslots,
      createdAt: v.createdat,
    }))

    return Response.json(entries)
  } catch {
    return Response.json([])
  }
}
