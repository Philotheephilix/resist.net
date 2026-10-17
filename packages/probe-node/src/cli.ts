// CLI entry: node dist/cli.js [--once] [--target=<url>] [--help]
import { parseArgs } from "node:util"
import { main } from "./index"
import { loadConfig, savePrevHash } from "./config"
import { probeTarget, TARGETS } from "./probe"
import { syncToArkiv } from "./sync"

const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|::1$|fc|fd)/i

const USAGE = `Usage: resist-probe [options]

Options:
  --once            Run a single probe tick and exit (no schedule, no health server)
  --target=<url>    Probe a single URL once and exit (implies --once; bypasses the
                    built-in target list)
  --help            Print this help message and exit

Environment variables:
  ARKIV_URL           URL of the Arkiv ingest endpoint (required)
  WALLET_PRIVATE_KEY  Override the auto-generated wallet private key
  HEALTHZ_PORT        Port for the /healthz HTTP endpoint (default: 9090)
  GEOHASH             Fallback geohash when ip-api.com is unreachable
  ISP                 Fallback ISP name when ip-api.com is unreachable
`

async function run() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      once:   { type: "boolean", default: false },
      target: { type: "string" },
      help:   { type: "boolean", default: false },
    },
    strict: true,
  })

  if (values.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }

  if (values.target) {
    let url: URL
    try {
      url = new URL(values.target)
    } catch {
      console.error(`[probe] --target value is not a valid URL: ${values.target}`)
      process.exit(1)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      console.error(`[probe] --target must be an http: or https: URL`)
      process.exit(1)
    }
    const allowedHostnames = TARGETS.map(t => new URL(t).hostname)
    if (!allowedHostnames.includes(url.hostname)) {
      console.error(`[probe] --target hostname '${url.hostname}' is not in the built-in target list`)
      process.exit(1)
    }
    if (PRIVATE_IP_RE.test(url.hostname)) {
      console.error(`[probe] --target hostname '${url.hostname}' resolves to a private/loopback address`)
      process.exit(1)
    }
    const config = await loadConfig()
    const result = await probeTarget(values.target, config)
    await syncToArkiv([result], config)
    await savePrevHash(config, result.prevResultHash)
    console.log(JSON.stringify(result, null, 2))
    return
  }

  await main({ once: values.once })
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
