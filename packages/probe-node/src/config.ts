import { ethers } from "ethers"
import fs from "fs"
import os from "os"
import path from "path"
import ngeohash from "ngeohash"

const CONFIG_PATH = path.join(os.homedir(), ".resist-net", "config.json")

interface IpApiResponse {
  status: string
  lat?: number
  lon?: number
  isp?: string
  org?: string
  query?: string
}

interface Config {
  wallet: string
  privateKey: string
  geohash: string
  isp: string
  networkType: "wifi" | "mobile" | "unknown"
  prevHash: string
}

async function detectLocation(): Promise<{ geohash: string; isp: string }> {
  try {
    const res = await fetch("https://ip-api.com/json?fields=status,lat,lon,isp,org,query", {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`ip-api status ${res.status}`)
    const data = (await res.json()) as IpApiResponse
    if (data.status !== "success" || data.lat == null || data.lon == null) {
      throw new Error("ip-api returned non-success")
    }
    // Validate WGS-84 bounds — a TLS-MITM captive portal could return out-of-range
    // coordinates to poison the geohash and misattribute all probe results from
    // this node to a false location (e.g., lat:9999 → geohash 'zzzzzzz' = North Pole).
    if (data.lat < -90 || data.lat > 90 || data.lon < -180 || data.lon > 180) {
      throw new Error("ip-api returned out-of-range coordinates")
    }
    const geohash = ngeohash.encode(data.lat, data.lon, 7)
    // Cap ISP length before writing to disk — a MITM on ip-api.com could return
    // an arbitrarily large ISP string that grows config.json unboundedly.
    const rawIsp = data.isp ?? data.org ?? "unknown"
    // Strip ASCII control characters (U+0000–U+001F) and Unicode bidi overrides
    // (U+202A–U+202E, U+2066–U+2069) that could cause log-viewer spoofing or
    // misattribution of probe results if embedded in stored ISP metadata.
    const isp = rawIsp.slice(0, 128).replace(/[\u0000-\u001F‪-‮⁦-⁩﻿]/g, "") || "unknown"
    return { geohash, isp }
  } catch {
    // Fallback: use env vars or defaults
    return {
      geohash: process.env.GEOHASH || "ttnnm77", // default: Mumbai
      isp: process.env.ISP || "unknown",
    }
  }
}

export async function savePrevHash(config: Config, prevHash: string): Promise<void> {
  const tmp = CONFIG_PATH + ".tmp." + process.pid
  try {
    // Caller already holds config in memory — skip the readFileSync/JSON.parse round-trip
    // and write the in-memory config with the updated prevHash directly.
    const updated = { ...config, prevHash }
    // Atomic write: write to a sibling temp file then rename so a crash between
    // truncate and write never leaves a corrupt CONFIG_PATH.
    fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, CONFIG_PATH)
  } catch (err) {
    // Non-fatal but must be logged — a silent failure leaves prevHash stale on disk
    // and causes the next tick to fork the tamper-evidence chain from the stale root.
    console.error("[probe] savePrevHash failed, chain continuity may be broken:", err)
    try { fs.unlinkSync(tmp) } catch { /* ignore cleanup failure */ }
  }
}

export async function loadConfig(): Promise<Config> {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })

  if (!fs.existsSync(CONFIG_PATH)) {
    const wallet = ethers.Wallet.createRandom()
    const { geohash, isp } = await detectLocation()
    const config: Config = {
      wallet: wallet.address,
      privateKey: wallet.privateKey,
      geohash,
      isp,
      networkType: "unknown",
      prevHash: "0".repeat(64),
    }
    // Use 'wx' (exclusive create) flag so only one process can create the file.
    // If two processes race on first start (e.g. systemd respawn), the loser gets
    // EEXIST and falls through to read the winner's config, preventing wallet fork.
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600, flag: "wx" })
      fs.chmodSync(CONFIG_PATH, 0o600)
      return config
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e
      // Lost the creation race — fall through to read the winner's config below
    }
  }

  // Enforce 0o600 on every startup — the existing file may have been created with
  // looser permissions (e.g., if the umask was relaxed at process start).
  fs.chmodSync(CONFIG_PATH, 0o600)
  const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config

  // Refresh geohash/ISP on each startup in case the node has moved or changed ISP
  const { geohash, isp } = await detectLocation()
  if (geohash !== stored.geohash || isp !== stored.isp) {
    stored.geohash = geohash
    stored.isp = isp
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 })
    fs.chmodSync(CONFIG_PATH, 0o600)
  }

  return stored
}
