// Probe node entry point
// Runs HTTP + DNS + TCP checks on a schedule, signs results, writes to Arkiv
// Falls back to local SQLite cache when offline

import { runProbe } from "./probe"
import { syncToArkiv } from "./sync"
import { loadConfig, savePrevHash } from "./config"

const INTERVAL_MS = 15 * 60 * 1000 // 15 min

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
  await tick()
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    tick()
      .catch((err) => console.error("[probe] tick error:", err))
      .finally(() => { running = false })
  }, INTERVAL_MS)
}
