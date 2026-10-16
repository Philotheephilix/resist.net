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
  await syncToArkiv(results, config)
  // Persist finalHash so the next tick threads the chain correctly.
  // Without this, every cycle re-reads the same stale prevHash from config.json
  // and the tamper-evidence chain resets on every probe cycle.
  await savePrevHash(config, finalHash)
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
