/**
 * CLI entry point.
 * Usage:
 *   resist-proxy volunteer [--wallet=<addr>] [--geohash=<hash>]
 *   resist-proxy user [--wallet=<addr>] [--geohash=<hash>]
 */

import { startVolunteer } from "./volunteer.js"
import { findAndConnect } from "./user.js"
import { ethers } from "ethers"
import fs from "fs"
import path from "path"
import os from "os"

const CONFIG_PATH = path.join(os.homedir(), ".resist-net", "config.json")

interface SavedConfig {
  wallet: string
  privateKey: string
  geohash: string
  isp: string
  networkType: "wifi" | "mobile" | "unknown"
  prevHash: string
}

async function detectGeohash(): Promise<string> {
  try {
    const res = await fetch("https://ip-api.com/json?fields=status,lat,lon", {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`ip-api ${res.status}`)
    const data = (await res.json()) as { status: string; lat?: number; lon?: number }
    if (data.status !== "success" || data.lat == null || data.lon == null) throw new Error("bad data")
    // Simple geohash encoding (6 chars, good enough for regional routing)
    // We use a bundled encode rather than importing ngeohash (not in this package's deps)
    return encodeGeohash(data.lat, data.lon, 6)
  } catch {
    return process.env["GEOHASH"] ?? "ttnnm7"
  }
}

/**
 * Minimal geohash encoder (Base32, standard geohash spec).
 */
function encodeGeohash(lat: number, lon: number, precision: number): string {
  const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
  let minLat = -90, maxLat = 90
  let minLon = -180, maxLon = 180
  let bit = 0, bitCount = 0, isEven = true
  let hash = ""
  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLon + maxLon) / 2
      if (lon >= mid) { bit = (bit << 1) | 1; minLon = mid }
      else { bit = bit << 1; maxLon = mid }
    } else {
      const mid = (minLat + maxLat) / 2
      if (lat >= mid) { bit = (bit << 1) | 1; minLat = mid }
      else { bit = bit << 1; maxLat = mid }
    }
    isEven = !isEven
    if (++bitCount === 5) {
      hash += BASE32[bit]
      bit = 0; bitCount = 0
    }
  }
  return hash
}

async function loadSavedConfig(): Promise<SavedConfig> {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })

  if (!fs.existsSync(CONFIG_PATH)) {
    const wallet = ethers.Wallet.createRandom()
    const geohash = await detectGeohash()
    const config: SavedConfig = {
      wallet: wallet.address,
      privateKey: wallet.privateKey,
      geohash,
      isp: "unknown",
      networkType: "unknown",
      prevHash: "0".repeat(64),
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
    return config
  }

  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as SavedConfig
}

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg)
    if (m) result[m[1]] = m[2]
  }
  return result
}

async function main(): Promise<void> {
  const [, , mode, ...rest] = process.argv
  const flags = parseArgs(rest)

  if (mode !== "volunteer" && mode !== "user") {
    console.error("Usage: resist-proxy volunteer|user [--wallet=<addr>] [--geohash=<hash>]")
    process.exit(1)
  }

  const saved = await loadSavedConfig()

  const wallet = flags["wallet"] ?? process.env["DEV_WALLET_ADDRESS"] ?? saved.wallet
  // Never accept --privateKey as a CLI flag — it would expose the key in `ps aux`.
  // Use DEV_PRIVATE_KEY env var or the auto-generated saved config instead.
  const privateKey = process.env["DEV_PRIVATE_KEY"] ?? saved.privateKey
  const geohash = flags["geohash"] ?? process.env["GEOHASH"] ?? saved.geohash
  const rpcUrl = flags["rpcUrl"] ?? process.env["ARKIV_RPC_URL"]
  const backendUrl = flags["backendUrl"] ?? process.env["RESIST_BACKEND_URL"] ?? "https://resist.net"

  if (mode === "volunteer") {
    await startVolunteer({
      wallet,
      privateKey,
      geohash,
      rpcUrl,
      capacitySlots: flags["slots"] ? parseInt(flags["slots"], 10) : 5,
      backendUrl,
    })
  } else {
    const conn = await findAndConnect({
      wallet,
      privateKey,
      myGeohash: geohash,
      rpcUrl,
      backendUrl,
    })
    console.log(
      `Proxy ready on 127.0.0.1:${conn.proxyPort} via volunteer ${conn.volunteerWallet}`
    )
    console.log("Press Ctrl+C to disconnect.")
    process.on("SIGINT", async () => {
      await conn.disconnect()
      process.exit(0)
    })
    process.on("SIGTERM", async () => {
      await conn.disconnect()
      process.exit(0)
    })
    // Keep alive
    await new Promise<never>(() => { /* never resolves */ })
  }
}

main().catch((err: unknown) => {
  console.error("[resist-proxy]", err)
  process.exit(1)
})
