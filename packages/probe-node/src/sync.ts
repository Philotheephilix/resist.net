// Writes probe results directly to Arkiv. No local SQLite cache.

import { ProbeResult } from "@resist/shared/src/types"
import { ArkivClient } from "@resist/arkiv-sdk/src/client.js"
import { TARGETS_HASH } from "./probe.js"

function getArkivRpcUrl(configRpcUrl?: string): string {
  const envUrl = process.env["ARKIV_RPC_URL"] ?? process.env["ARKIV_URL"]
  if (!configRpcUrl && !envUrl) {
    console.warn('[sync] ARKIV_RPC_URL not set — falling back to testnet endpoint')
  }
  return configRpcUrl ?? envUrl ?? "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
}

function buildClient(config: { privateKey?: string; rpcUrl?: string }): ArkivClient | null {
  if (!config.privateKey) return null
  try {
    return new ArkivClient({
      rpcUrl: getArkivRpcUrl(config.rpcUrl),
      privateKey: config.privateKey as `0x${string}`,
      canonicalTargetsHash: TARGETS_HASH,
    })
  } catch {
    return null
  }
}

async function writeHeartbeat(
  client: ArkivClient,
  config: { wallet: string; geohash: string; isp: string; networkType?: "wifi" | "mobile" | "unknown" },
): Promise<void> {
  try {
    await client.writeNodeIdentity({
      wallet: config.wallet,
      geohash: config.geohash,
      isp: config.isp,
      networkType: config.networkType ?? "unknown",
      capabilities: ["probe"],
      lastSeenAt: Date.now(),
    })
    console.log('[sync] heartbeat written')
  } catch (err) {
    console.warn('[sync] heartbeat failed:', err instanceof Error ? err.message : err)
  }
}

export function getPendingRowCount(): number {
  return 0
}

export async function syncToArkiv(
  results: ProbeResult[],
  config?: {
    wallet: string
    privateKey?: string
    rpcUrl?: string
    geohash: string
    isp: string
    networkType?: "wifi" | "mobile" | "unknown"
  },
) {
  const client = config ? buildClient(config) : null

  if (!client) {
    console.warn('[sync] No privateKey configured — results not written to Arkiv')
    return
  }

  for (const result of results) {
    const safeResult = { ...result, geohash: result.geohash.slice(0, 5) }
    try {
      await client.writeProbeResult(safeResult)
      console.log(`[sync] wrote ${safeResult.targetUrl} reachable=${safeResult.reachable}`)
    } catch (err) {
      console.warn(`[sync] write failed for ${safeResult.targetUrl}:`, err instanceof Error ? err.message : err)
    }
  }

  if (config) {
    await writeHeartbeat(client, { ...config, geohash: config.geohash.slice(0, 5) })
  }
}
