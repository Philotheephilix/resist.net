// Probe node entry point
// Runs HTTP + DNS + TCP checks on a schedule, signs results, writes to Arkiv
// Falls back to local SQLite cache when offline

import { runProbe } from "./probe"
import { syncToArkiv } from "./sync"
import { loadConfig, savePrevHash } from "./config"

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

export async function main() {
  let running = true
  let consecutiveFailures = 0
  let currentInterval = INTERVAL_MS

  function scheduleNext() {
    setTimeout(() => {
      if (running) {
        scheduleNext()
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
  }
  scheduleNext()
}
