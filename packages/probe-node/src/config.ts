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
    const isp = rawIsp.slice(0, 128)
    return { geohash, isp }
  } catch {
    // Fallback: use env vars or defaults
    return {
      geohash: process.env.GEOHASH || "ttnnm77", // default: Mumbai
      isp: process.env.ISP || "unknown",
    }
  }
}

export async function savePrevHash(prevHash: string): Promise<void> {
  try {
    const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config
    stored.prevHash = prevHash
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 })
  } catch {
    // Non-fatal: if we can't persist prevHash the chain just resets from this point
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
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
    return config
  }

  const stored = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config

  // Refresh geohash/ISP on each startup in case the node has moved or changed ISP
  const { geohash, isp } = await detectLocation()
  if (geohash !== stored.geohash || isp !== stored.isp) {
    stored.geohash = geohash
    stored.isp = isp
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), { mode: 0o600 })
  }

  return stored
}
