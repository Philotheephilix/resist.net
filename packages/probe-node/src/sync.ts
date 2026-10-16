// Writes probe results to Arkiv. Falls back to local SQLite cache when offline.
// On reconnect, drains the cache in batch.

import Database from "better-sqlite3"
import os from "os"
import path from "path"
import fs from "fs"
import { ProbeResult } from "@resist/shared/src/types"
import { ArkivClient } from "@resist/arkiv-sdk/src/client.js"

// os.homedir() correctly handles missing HOME env var (Docker, systemd PrivateUsers)
// unlike `process.env.HOME || '~'` which leaves a literal '~' in the path.
const DB_PATH = path.join(os.homedir(), ".resist-net", "offline-cache.db")

function getArkivRpcUrl(configRpcUrl?: string): string {
  return (
    configRpcUrl ??
    process.env["ARKIV_RPC_URL"] ??
    "https://rpc.tiramisu.db-chain.testnet.arkiv.network"
  )
}

// Client-side write-rate guard: max results submitted to Arkiv per wallet per hour.
// This caps the damage from a misconfigured or malicious binary running at INTERVAL_MS=0.
// The limit is intentionally generous vs. normal usage (5 targets × 4 ticks/hour = 20/hr)
// to give headroom for offline-cache drain bursts while still blocking flood attacks.
const MAX_WRITES_PER_WALLET_PER_HOUR = 200
// wallet → { count, windowStart }
const _walletWriteRateMap = new Map<string, { count: number; windowStart: number }>()

function checkWalletWriteRate(wallet: string): boolean {
  const now = Date.now()
  const entry = _walletWriteRateMap.get(wallet)
  if (!entry || now - entry.windowStart > 3_600_000) {
    _walletWriteRateMap.set(wallet, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= MAX_WRITES_PER_WALLET_PER_HOUR) return false
  entry.count++
  return true
}

// Module-level singleton — opens the DB once per process and runs DDL once.
// Previously getDb() opened + closed a connection on every syncToArkiv() call
// and re-ran CREATE TABLE IF NOT EXISTS on every invocation (a DDL statement
// that SQLite must parse and check on each call). The singleton removes both
// costs and also allows prepared statements to be cached at module level.
let _db: Database.Database | null = null
// Module-level prepared statements — initialized once alongside the DB singleton.
// Re-preparing inside syncToArkiv() on every call wastes SQLite parse time; hoisting
// here means each statement is compiled once per process lifetime.
let stmtEvict: Database.Statement | null = null
let stmtDeleteById: Database.Statement | null = null
let stmtInsert: Database.Statement | null = null
let stmtSelectPending: Database.Statement | null = null

function getDb(): Database.Database {
  if (_db) return _db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)
  // WAL mode: readers don't block writers and vice-versa; safe for concurrent probe loops.
  // busy_timeout: retry for up to 5s instead of throwing SQLITE_BUSY immediately.
  _db.pragma("journal_mode = WAL")
  _db.pragma("busy_timeout = 5000")
  _db.exec(`CREATE TABLE IF NOT EXISTS pending (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  stmtEvict = _db.prepare("DELETE FROM pending WHERE created_at < ?")
  stmtDeleteById = _db.prepare("DELETE FROM pending WHERE id = ?")
  stmtInsert = _db.prepare("INSERT OR IGNORE INTO pending (id, payload, created_at) VALUES (?, ?, ?)")
  // LIMIT bounds memory on large offline backlogs (e.g. 24h of probes = thousands of rows).
  // 100 rows per cycle: at 15-minute sync intervals a 200-row backlog drains in 2 cycles
  // (30 min) instead of 4 (60 min) with LIMIT 50, while each batch still completes well
  // within the 15-minute window (5 targets × 8s timeout × 100 = ~400s worst-case,
  // in practice <10s since most writes succeed in <100ms each).
  stmtSelectPending = _db.prepare("SELECT * FROM pending ORDER BY created_at ASC LIMIT 100")
  return _db
}

/**
 * Build an ArkivClient from config.
 * Returns null if no private key is present (read-only / observer mode).
 */
function buildClient(config: { privateKey?: string; rpcUrl?: string }): ArkivClient | null {
  if (!config.privateKey) return null
  try {
    return new ArkivClient({
      rpcUrl: getArkivRpcUrl(config.rpcUrl),
      privateKey: config.privateKey as `0x${string}`,
    })
  } catch {
    return null
  }
}

async function writeToArkiv(client: ArkivClient, result: ProbeResult): Promise<boolean> {
  try {
    await client.writeProbeResult(result)
    return true
  } catch (err) {
    // Surface 429 rate-limit errors distinctly so the caller can back off.
    // Silently returning false on 429 treats rate-limiting as a permanent failure
    // and re-queues the row on every cycle without any backoff.
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
      console.warn('[sync] Arkiv rate-limited (429) — backing off drain for this cycle')
      throw err  // propagate to allSettled as rejection; caller counts it as a skip
    }
    // Log non-429 failures so operators can detect persistent write errors (auth, 400, 500, network)
    // without needing to infer them from the growing offline cache size.
    console.warn('[sync] Arkiv write failed (non-429), queuing locally:', msg)
    return false
  }
}

async function writeHeartbeat(
  client: ArkivClient,
  config: {
    wallet: string
    geohash: string
    isp: string
    networkType?: "wifi" | "mobile" | "unknown"
  },
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
  } catch {
    // Non-fatal: heartbeat failure must not block probe writes
  }
}

export function getPendingRowCount(): number {
  const db = getDb()
  const row = db.prepare("SELECT COUNT(*) AS cnt FROM pending").get() as { cnt: number }
  return row.cnt
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
  const db = getDb()
  const client = config ? buildClient(config) : null

  if (!client) {
    console.warn('[sync] No privateKey configured — results are only cached locally, not written to Arkiv')
  }

  // --- evict stale rows older than 48h (past Arkiv ProbeResult TTL) ---
  const cutoffMs = Date.now() - 48 * 3600 * 1000
  stmtEvict!.run(cutoffMs)

  // --- drain offline cache first (batch of 100 rows per cycle) ---
  // All 100 rows run concurrently but are throttled by a semaphore at DRAIN_CONCURRENCY=5
  // concurrent in-flight writes. This removes the sequential barrier between old chunks
  // (previously a slow row at position 4 blocked the next chunk from starting) while
  // keeping the Arkiv RPC rate-limit safe. Wall-clock drain time ≈ ceil(N/C) × avg_write_ms.
  const DRAIN_CONCURRENCY = 5  // conservative to avoid 429 rate-limits from Arkiv RPC
  const pending = stmtSelectPending!.all() as { id: string; payload: string }[]
  const successfulIds: string[] = []

  if (client && pending.length > 0) {
    let inFlight = 0
    let next = 0
    let rateLimited = false  // abort drain immediately on first 429
    const results_drain: boolean[] = new Array(pending.length).fill(false)
    await new Promise<void>((resolve) => {
      const schedule = () => {
        // Stop dispatching new items as soon as rate-limiting is detected.
        // Without this guard all remaining items fire despite the 429 signal,
        // worsening the rate-limit backoff window on the Arkiv RPC server.
        if (rateLimited) { if (inFlight === 0) resolve(); return }
        while (inFlight < DRAIN_CONCURRENCY && next < pending.length) {
          const idx = next++
          inFlight++
          const row = pending[idx]!
          const drainResult = JSON.parse(row.payload) as ProbeResult
          const safeDrainResult = { ...drainResult, geohash: drainResult.geohash.slice(0, 5) }
          if (!checkWalletWriteRate(safeDrainResult.nodeWallet)) {
            console.warn('[sync] client-side write-rate limit reached for wallet during drain — skipping remaining')
            results_drain[idx] = false
            inFlight--
            // Rate cap hit — stop draining for this cycle; remaining rows stay cached.
            if (inFlight === 0) resolve()
            break
          }
          writeToArkiv(client!, safeDrainResult)
            .then(ok => { results_drain[idx] = ok })
            .catch((err) => {
              results_drain[idx] = false
              const msg = err instanceof Error ? err.message : String(err)
              if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
                rateLimited = true
              }
            })
            .finally(() => { inFlight--; schedule() })
        }
        if (inFlight === 0) resolve()
      }
      schedule()
    })
    for (let i = 0; i < pending.length; i++) {
      if (results_drain[i]) successfulIds.push(pending[i]!.id)
    }
  }

  if (successfulIds.length > 0) {
    const deleteBatch = db.transaction((ids: string[]) => {
      for (const id of ids) stmtDeleteById!.run(id)
    })
    deleteBatch(successfulIds)
  }

  // --- write new results (parallel) ---
  // Up to 5 results per tick; Promise.allSettled lets all complete regardless of
  // individual failures, mirroring the drain path's concurrent write pattern.
  await Promise.allSettled(results.map(async result => {
    const safeResult = { ...result, geohash: result.geohash.slice(0, 5) }
    let wrote = false
    if (client) {
      if (!checkWalletWriteRate(safeResult.nodeWallet)) {
        console.warn('[sync] client-side write-rate limit reached for wallet — queuing locally')
      } else {
        try {
          wrote = await writeToArkiv(client, safeResult)
        } catch {
          // 429 rate-limit: writeToArkiv re-throws; treat as a cache miss so
          // the result is queued locally rather than silently dropped.
          wrote = false
        }
      }
    }
    if (!wrote) {
      // Use wall-clock insert time (not result.timestamp) so the 48h eviction
      // window starts from when the row was actually cached, not when the probe ran.
      stmtInsert!.run(safeResult.id, JSON.stringify(safeResult), Date.now())
    }
  }))

  // --- NodeIdentity heartbeat (30-minute TTL per spec) ---
  if (client && config) {
    await writeHeartbeat(client, { ...config, geohash: config.geohash.slice(0, 5) })
  }
}
