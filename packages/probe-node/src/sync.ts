// Writes probe results directly to Arkiv (Tiramisu testnet). No local cache.
//
// Arkiv write path per probe cycle:
//   1. writeProbeResult()  → creates a "proberesult" entity (TTL 48h) per target
//   2. writeNodeIdentity() → upserts a "nodeidentity" heartbeat entity (TTL 30min)
//
// If DEV_PRIVATE_KEY is absent the results are logged but not written to chain.
// All entity attribute names MUST be lowercase — Tiramisu node rejects uppercase.

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

// Writes a "nodeidentity" heartbeat to Arkiv (TTL 30min). Called after every probe cycle.
// The dashboard queries these to show live node count and filter probe results to
// established wallets (active within the last hour) for quorum verification.
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
    // Truncate geohash to 5 chars before writing — Arkiv str limit is 128 bytes
    // but the dashboard only queries on up to 5-char prefixes anyway.
    const safeResult = { ...result, geohash: result.geohash.slice(0, 5) }
    try {
      // Writes a "proberesult" entity to Arkiv with 48h TTL.
      // Returns the entity key (0x + 64 hex chars) logged below.
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
