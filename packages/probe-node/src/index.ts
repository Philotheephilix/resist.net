// Probe node entry point
// Runs HTTP + DNS + TCP checks on a schedule, signs results, writes to Arkiv
// Falls back to local SQLite cache when offline

import { runProbe } from "./probe";
import { syncToArkiv } from "./sync";
import { loadConfig } from "./config";

const INTERVAL_MS = 15 * 60 * 1000; // 15 min

async function tick() {
  const config = loadConfig();
  const result = await runProbe(config);
  await syncToArkiv(result);
}

tick();
setInterval(tick, INTERVAL_MS);
