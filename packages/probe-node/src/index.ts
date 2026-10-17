// Probe node entry point
// Runs HTTP + DNS + TCP checks on a schedule, signs results, writes to Arkiv
// Falls back to local SQLite cache when offline
// Also polls for custom probe queue jobs from Arkiv and executes them

import http from "http"
import { runProbe } from "./probe"
import { syncToArkiv, getPendingRowCount } from "./sync"
import { loadConfig, savePrevHash } from "./config"
import { QueueWorker } from "./queue"

const HEALTHZ_PORT = parseInt(process.env["HEALTHZ_PORT"] ?? "9090", 10)
const PENDING_ALERT_THRESHOLD = 500

function startHealthServer() {
  http.createServer((_req, res) => {
    const pending = getPendingRowCount()
    const status = pending >= PENDING_ALERT_THRESHOLD ? "degraded" : "ok"
    if (pending >= PENDING_ALERT_THRESHOLD) {
      console.warn(`[sync] offline cache depth ${pending} >= ${PENDING_ALERT_THRESHOLD} — Arkiv may be unreachable`)
    }
    res.writeHead(status === "ok" ? 200 : 503, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status, pending_rows: pending, threshold: PENDING_ALERT_THRESHOLD }))
  }).listen(HEALTHZ_PORT)
}

const INTERVAL_MS = 15 * 60 * 1000 // 15 min
const MAX_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 h
const BACKOFF_THRESHOLD = 3

async function tick() {
  const config = await loadConfig()
  const { results, finalHash } = await runProbe(config)
  try {
    await syncToArkiv(results, config)
  } finally {
    // Always persist finalHash even if syncToArkiv throws mid-batch.
    // Without try/finally, a partial Arkiv write followed by a throw would leave
    // prevHash stale on disk and fork the tamper-evidence chain on the next tick.
    await savePrevHash(config, finalHash)
  }
}

export async function main(opts: { once?: boolean } = {}) {
  if (!opts.once) startHealthServer()
  let running = true
  let consecutiveFailures = 0
  let currentInterval = INTERVAL_MS
  let shutdownRequested = false
  let drainResolve: (() => void) | null = null

  // Start probe queue worker — accepts either ARKIV_RPC_URL or ARKIV_URL (same endpoint)
  let queueWorker: QueueWorker | null = null
  if (!opts.once) {
    const rpcUrl = process.env["ARKIV_RPC_URL"] ?? process.env["ARKIV_URL"]
    if (rpcUrl) {
      const config = await loadConfig()
      queueWorker = new QueueWorker(rpcUrl, config)
      queueWorker.start()
    } else {
      console.warn("[queue] ARKIV_RPC_URL / ARKIV_URL not set — queue worker disabled")
    }
  }

  const shutdown = () => {
    if (shutdownRequested) return
    shutdownRequested = true
    queueWorker?.stop()
    console.log("[probe] shutdown requested — waiting for in-flight tick to complete")
    if (!running) {
      process.exit(0)
    }
    // running=true means a tick is in progress; drainResolve is called in the finally block below
    new Promise<void>((resolve) => { drainResolve = resolve })
      .then(() => process.exit(0))
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  function scheduleNext() {
    setTimeout(() => {
      if (running) {
        return
      }
      if (shutdownRequested) {
        process.exit(0)
        return
      }
      running = true
      tick()
        .then(() => {
          consecutiveFailures = 0
          currentInterval = INTERVAL_MS
        })
        .catch((err) => {
          console.error("[probe] tick error:", err)
          consecutiveFailures++
          if (consecutiveFailures >= BACKOFF_THRESHOLD) {
            currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL_MS)
          }
        })
        .finally(() => {
          running = false
          if (drainResolve) { drainResolve(); return }
          scheduleNext()
        })
    }, currentInterval)
  }

  // Set running=true before the initial tick so a concurrent scheduleNext fire
  // (if the timer fires before tick() resolves on an overloaded system) is dropped.
  try {
    await tick()
    consecutiveFailures = 0
  } catch (err) {
    console.error("[probe] initial tick error:", err)
    consecutiveFailures++
  } finally {
    running = false
    const dr = drainResolve as (() => void) | null
    if (dr) { dr(); return }
  }
  if (opts.once) return
  if (shutdownRequested) { process.exit(0); return }
  scheduleNext()
}
