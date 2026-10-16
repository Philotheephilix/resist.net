/**
 * Arkiv SDK client for resist.net
 *
 * Critical constraints (from skill references):
 *  - All attribute names MUST be lowercase only (node rejects uppercase with Ident32InvalidByte)
 *  - Use u64(BigInt(...)) for timestamps, NOT bare numbers (i32 range is too small for ms timestamps)
 *  - ne/exists/hasType predicates are NOT supported — use NOT (a = v) pattern instead
 *  - Always filter project='resist.net' first in queries
 *  - Use ExpirationTime.fromHours/fromMinutes etc for TTL
 */

import {
  createWalletClient,
  createPublicClient,
  ExpirationTime,
  u64,
  str,
  bool,
  i32,
  type Expression,
} from "@arkiv-network/sdk"
import { and, eq, gte, startsWith } from "@arkiv-network/sdk/query"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type {
  ProbeResult,
  VolunteerProxyEntry,
  NodeIdentityEntry,
  SignalExchangeEntry,
  ProbeResultRow,
  VolunteerProxyRow,
  SignalExchangeRow,
} from "./types.js"

export interface ArkivClientConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
}

export class ArkivClient {
  private readonly walletClient: ReturnType<typeof createWalletClient>
  private readonly publicClient: ReturnType<typeof createPublicClient>

  constructor(config: ArkivClientConfig) {
    const account = privateKeyToAccount(config.privateKey)
    const transport = http(config.rpcUrl)

    this.walletClient = createWalletClient({
      chain: tiramisu,
      transport,
      account,
    })

    this.publicClient = createPublicClient({
      chain: tiramisu,
      transport,
    })
  }

  /**
   * Write a ProbeResult to Arkiv with 48h TTL.
   * Returns the entity key (hex string).
   */
  async writeProbeResult(result: ProbeResult): Promise<string> {
    // Build base attributes — all MUST be lowercase
    const baseAttrs = {
      project: "resist.net",
      entitytype: "proberesult",
      nodewallet: str(result.nodeWallet),
      targeturl: str(result.targetUrl.slice(0, 128)), // str max 128 UTF-8 bytes
      timestamp: u64(BigInt(result.timestamp)),
      reachable: bool(result.reachable),
      geohash: str(result.geohash),
      isp: str(result.isp.slice(0, 128)),
      networktype: str(result.networkType),
      // optional fields — use empty str when absent to keep schema consistent
      blocktype: result.blockType !== null ? str(result.blockType) : str(""),
      httpstatus: i32(result.httpStatus ?? -1),
      responsetimems: i32(result.responseTimeMs !== null ? Math.min(result.responseTimeMs, 2147483647) : -1),
      // first-class queryable attribute so chain continuity can be verified by
      // dashboards and off-chain validators without parsing the opaque payload
      prevresulthash: str(result.prevResultHash),
      // first-class queryable attribute so the read path can reject rows from
      // probes that used a non-canonical target set
      targetshash: str(result.targetsHash),
    }

    const { entityKey } = await this.walletClient.createEntity({
      payload: new TextEncoder().encode(JSON.stringify({
        id: result.id,
        dnsPoisoned: result.dnsPoisoned,
        dnsExpected: result.dnsExpected,
        dnsReceived: result.dnsReceived,
        tcpConnected: result.tcpConnected,
        tcpRstInjected: result.tcpRstInjected,
        prevResultHash: result.prevResultHash,
      })),
      contentType: "application/json",
      attributes: baseAttrs,
      expires: ExpirationTime.fromHours(48),
    })

    return entityKey
  }

  /**
   * Write a VolunteerProxy SDP offer with 5min TTL.
   * Returns the entity key.
   */
  async writeVolunteerProxy(proxy: VolunteerProxyEntry): Promise<string> {
    const { entityKey } = await this.walletClient.createEntity({
      payload: new TextEncoder().encode(proxy.sdpOffer),
      contentType: "application/json",
      attributes: {
        project: "resist.net",
        entitytype: "volunteerproxy",
        wallet: str(proxy.wallet),
        geohash: str(proxy.geohash),
        capacityslots: i32(proxy.capacitySlots),
        createdat: u64(BigInt(proxy.createdAt)),
        // sdpoffer stored in payload (can exceed 128-byte str limit)
      },
      expires: ExpirationTime.fromMinutes(5),
    })

    return entityKey
  }

  /**
   * Extend a VolunteerProxy TTL by 5 minutes (called every 4min to keep it alive).
   */
  async refreshVolunteerProxy(entityId: string): Promise<void> {
    await this.walletClient.extendEntity({
      entityKey: entityId as `0x${string}`,
      expires: ExpirationTime.fromMinutes(5),
    })
  }

  /**
   * Write a NodeIdentity heartbeat with 30min TTL.
   */
  async writeNodeIdentity(identity: NodeIdentityEntry): Promise<void> {
    await this.walletClient.createEntity({
      payload: new TextEncoder().encode(JSON.stringify({
        capabilities: identity.capabilities,
      })),
      contentType: "application/json",
      attributes: {
        project: "resist.net",
        entitytype: "nodeidentity",
        wallet: str(identity.wallet),
        geohash: str(identity.geohash),
        isp: str(identity.isp.slice(0, 128)),
        networktype: str(identity.networkType),
        lastseenms: u64(BigInt(identity.lastSeenAt)),
      },
      expires: ExpirationTime.fromMinutes(30),
    })
  }

  /**
   * Write a SignalExchange (WebRTC answer SDP) with 2min TTL.
   * Returns the entity key so the caller can delete it on failure.
   */
  async writeSignalExchange(exchange: SignalExchangeEntry): Promise<string> {
    const { entityKey } = await this.walletClient.createEntity({
      payload: new TextEncoder().encode(exchange.sdpAnswer),
      contentType: "application/json",
      attributes: {
        project: "resist.net",
        entitytype: "signalexchange",
        volunteerwallet: str(exchange.volunteerWallet),
        clientwallet: str(exchange.clientWallet),
        createdat: u64(BigInt(exchange.createdAt)),
      },
      expires: ExpirationTime.fromMinutes(2),
    })
    return entityKey
  }

  /**
   * Delete an entity by its key (best-effort cleanup).
   */
  async deleteEntity(entityKey: string): Promise<void> {
    await this.walletClient.deleteEntity({ entityKey: entityKey as `0x${string}` })
  }

  /**
   * Query ProbeResults by geohash prefix (for map rendering).
   * Filters: project=resist.net, entitytype=proberesult, optional geohash prefix, optional since timestamp.
   */
  async queryProbeResults(opts: {
    geohashPrefix?: string;
    blockType?: string;
    since?: number;
    limit?: number;
  } = {}): Promise<ProbeResultRow[]> {
    // Explicitly type as Expression[] so the and() overload resolves correctly
    const filters: Expression[] = [
      eq("project", "resist.net"),
      eq("entitytype", "proberesult"),
    ]

    if (opts.geohashPrefix) {
      filters.push(startsWith("geohash", opts.geohashPrefix))
    }

    if (opts.blockType) {
      filters.push(eq("blocktype", opts.blockType))
    }

    if (opts.since !== undefined) {
      filters.push(gte("timestamp", u64(BigInt(opts.since))))
    }

    const page = await this.publicClient
      .select({ key: true, attributes: true })
      .where(and(filters))
      .limit(opts.limit ?? 100)
      .fetch()

    const rows: ProbeResultRow[] = []

    for (const entity of page.entities) {
      const a = entity.attributes
      rows.push({
        entityKey: entity.key as string,
        nodewallet: String(a["nodewallet"]?.value ?? ""),
        targeturl: String(a["targeturl"]?.value ?? ""),
        timestamp: Number(a["timestamp"]?.value ?? 0),
        reachable: Boolean(a["reachable"]?.value ?? false),
        blocktype: a["blocktype"] && String(a["blocktype"].value) ? String(a["blocktype"].value) : null,
        httpstatus: (a["httpstatus"] != null && Number(a["httpstatus"].value) !== -1) ? Number(a["httpstatus"].value) : null,
        responsetimems: (a["responsetimems"] != null && Number(a["responsetimems"].value) !== -1) ? Number(a["responsetimems"].value) : null,
        geohash: String(a["geohash"]?.value ?? ""),
        isp: String(a["isp"]?.value ?? ""),
        networktype: String(a["networktype"]?.value ?? ""),
        prevresulthash: String(a["prevresulthash"]?.value ?? ""),
        targetshash: String(a["targetshash"]?.value ?? ""),
      })
    }

    // Detect chain gaps: for each wallet, sort by timestamp and flag any row whose
    // prevresulthash is not the all-zeroes genesis value AND does not match the
    // entityKey of the immediately preceding result from that wallet.
    const byWallet = new Map<string, ProbeResultRow[]>()
    for (const row of rows) {
      const bucket = byWallet.get(row.nodewallet) ?? []
      bucket.push(row)
      byWallet.set(row.nodewallet, bucket)
    }
    for (const bucket of byWallet.values()) {
      bucket.sort((a, b) => a.timestamp - b.timestamp)
      for (let i = 0; i < bucket.length; i++) {
        const row = bucket[i]!
        if (i === 0) {
          // First known result for this wallet in the window — gap undetectable
          // (earlier results may have expired), skip.
          continue
        }
        const prev = bucket[i - 1]!
        const ZERO_HASH = "0".repeat(64)
        if (row.prevresulthash !== ZERO_HASH && row.prevresulthash !== prev.entityKey) {
          row.chainGap = true
        }
      }
    }

    return rows
  }

  /**
   * Query live VolunteerProxy offers, optionally excluding entries from a geohash prefix
   * (so a node doesn't route to itself).
   *
   * Note: ne/exists/hasType predicates are NOT supported by Tiramisu node.
   * Geohash exclusion is done client-side.
   */
  async queryVolunteers(excludeGeohashPrefix?: string): Promise<VolunteerProxyRow[]> {
    const page = await this.publicClient
      .select({ key: true, attributes: true, payload: true })
      .where(and([
        eq("project", "resist.net"),
        eq("entitytype", "volunteerproxy"),
      ]))
      .limit(200)
      .fetch()

    const rows: VolunteerProxyRow[] = []

    for (const entity of page.entities) {
      const a = entity.attributes
      const geohash = String(a["geohash"]?.value ?? "")

      // Client-side exclusion of same-prefix entries
      if (excludeGeohashPrefix && geohash.startsWith(excludeGeohashPrefix)) {
        continue
      }

      const sdpOffer = entity.payload
        ? new TextDecoder().decode(entity.payload)
        : ""

      rows.push({
        entityKey: entity.key as string,
        wallet: String(a["wallet"]?.value ?? ""),
        sdpoffer: sdpOffer,
        geohash,
        capacityslots: Number(a["capacityslots"]?.value ?? 0),
        createdat: Number(a["createdat"]?.value ?? 0),
      })
    }

    return rows
  }

  /**
   * Query SignalExchanges for a specific volunteer wallet.
   */
  async querySignalExchange(volunteerWallet: string): Promise<SignalExchangeRow[]> {
    const page = await this.publicClient
      .select({ key: true, attributes: true, payload: true })
      .where(and([
        eq("project", "resist.net"),
        eq("entitytype", "signalexchange"),
        eq("volunteerwallet", volunteerWallet),
      ]))
      .limit(50)
      .fetch()

    const rows: SignalExchangeRow[] = []

    for (const entity of page.entities) {
      const a = entity.attributes
      const sdpAnswer = entity.payload
        ? new TextDecoder().decode(entity.payload)
        : ""

      rows.push({
        entityKey: entity.key as string,
        volunteerwallet: String(a["volunteerwallet"]?.value ?? ""),
        clientwallet: String(a["clientwallet"]?.value ?? ""),
        sdpanswer: sdpAnswer,
        createdat: Number(a["createdat"]?.value ?? 0),
      })
    }

    return rows
  }
}

/**
 * Create an ArkivClient from environment variables (requires signing key).
 */
export function createArkivClientFromEnv(): ArkivClient {
  const rpcUrl = process.env["ARKIV_RPC_URL"]
  const privateKey = process.env["DEV_PRIVATE_KEY"]

  if (!rpcUrl) throw new Error("ARKIV_RPC_URL environment variable is required")
  if (!privateKey) throw new Error("DEV_PRIVATE_KEY environment variable is required")

  return new ArkivClient({
    rpcUrl,
    privateKey: privateKey as `0x${string}`,
  })
}

/**
 * Read-only Arkiv client — only needs the RPC URL, no private key.
 * Use this in API routes that only query data (no writes/signs).
 */
export class ArkivReadClient {
  readonly publicClient: ReturnType<typeof createPublicClient>

  constructor(rpcUrl: string) {
    this.publicClient = createPublicClient({
      chain: tiramisu,
      transport: http(rpcUrl),
    })
  }

  async queryProbeResults(opts: {
    geohashPrefix?: string;
    blockType?: string;
    since?: number;
    limit?: number;
  } = {}): Promise<import("./types.js").ProbeResultRow[]> {
    const filters: Expression[] = [
      eq("project", "resist.net"),
      eq("entitytype", "proberesult"),
    ]
    if (opts.geohashPrefix) filters.push(startsWith("geohash", opts.geohashPrefix))
    if (opts.blockType) filters.push(eq("blocktype", opts.blockType))
    if (opts.since !== undefined) filters.push(gte("timestamp", u64(BigInt(opts.since))))

    const page = await this.publicClient
      .select({ key: true, attributes: true })
      .where(and(filters))
      .limit(opts.limit ?? 100)
      .fetch()

    const rows = page.entities.map((entity) => {
      const a = entity.attributes
      return {
        entityKey: entity.key as string,
        nodewallet: String(a["nodewallet"]?.value ?? ""),
        targeturl: String(a["targeturl"]?.value ?? ""),
        timestamp: Number(a["timestamp"]?.value ?? 0),
        reachable: Boolean(a["reachable"]?.value ?? false),
        blocktype: a["blocktype"] && String(a["blocktype"].value) ? String(a["blocktype"].value) : null,
        httpstatus: (a["httpstatus"] != null && Number(a["httpstatus"].value) !== -1) ? Number(a["httpstatus"].value) : null,
        responsetimems: (a["responsetimems"] != null && Number(a["responsetimems"].value) !== -1) ? Number(a["responsetimems"].value) : null,
        geohash: String(a["geohash"]?.value ?? ""),
        isp: String(a["isp"]?.value ?? ""),
        networktype: String(a["networktype"]?.value ?? ""),
        prevresulthash: String(a["prevresulthash"]?.value ?? ""),
        targetshash: String(a["targetshash"]?.value ?? ""),
      }
    })

    // Detect chain gaps at query time: flag rows whose prevresulthash doesn't match
    // the preceding result's entityKey for that wallet (same logic as ArkivClient).
    const byWallet = new Map<string, import("./types.js").ProbeResultRow[]>()
    for (const row of rows) {
      const bucket = byWallet.get(row.nodewallet) ?? []
      bucket.push(row)
      byWallet.set(row.nodewallet, bucket)
    }
    for (const bucket of byWallet.values()) {
      bucket.sort((a, b) => a.timestamp - b.timestamp)
      const ZERO_HASH = "0".repeat(64)
      for (let i = 1; i < bucket.length; i++) {
        const row = bucket[i]!
        const prev = bucket[i - 1]!
        if (row.prevresulthash !== ZERO_HASH && row.prevresulthash !== prev.entityKey) {
          row.chainGap = true
        }
      }
    }

    return rows
  }

  async queryVolunteers(excludeGeohashPrefix?: string): Promise<import("./types.js").VolunteerProxyRow[]> {
    const page = await this.publicClient
      .select({ key: true, attributes: true, payload: true })
      .where(and([
        eq("project", "resist.net"),
        eq("entitytype", "volunteerproxy"),
      ]))
      .limit(200)
      .fetch()

    return page.entities
      .map((entity) => {
        const a = entity.attributes
        const geohash = String(a["geohash"]?.value ?? "")
        if (excludeGeohashPrefix && geohash.startsWith(excludeGeohashPrefix)) return null
        return {
          entityKey: entity.key as string,
          wallet: String(a["wallet"]?.value ?? ""),
          sdpoffer: entity.payload ? new TextDecoder().decode(entity.payload) : "",
          geohash,
          capacityslots: Number(a["capacityslots"]?.value ?? 0),
          createdat: Number(a["createdat"]?.value ?? 0),
        }
      })
      .filter((r): r is import("./types.js").VolunteerProxyRow => r !== null)
  }

  async queryNodeIdentities(): Promise<import("./types.js").NodeIdentityRow[]> {
    const page = await this.publicClient
      .select({ key: true, attributes: true })
      .where(and([
        eq("project", "resist.net"),
        eq("entitytype", "nodeidentity"),
      ]))
      .limit(500)
      .fetch()

    return page.entities.map((entity) => {
      const a = entity.attributes
      return {
        entityKey: entity.key as string,
        wallet: String(a["wallet"]?.value ?? ""),
        geohash: String(a["geohash"]?.value ?? ""),
        isp: String(a["isp"]?.value ?? ""),
        networktype: String(a["networktype"]?.value ?? ""),
        lastseenms: Number(a["lastseenms"]?.value ?? 0),
      }
    })
  }
}
