# ResistNet — Arkiv Schema

All entities use `project: "resist.net"` as the namespace. Every query filters on this first.

---

## Entity Types

### 1. `proberesult`

A single reachability check from one volunteer node against one target URL.

**Attributes (queryable):**

| Attribute | Type | Description |
|---|---|---|
| `project` | `str` | Always `"resist.net"` |
| `entitytype` | `str` | Always `"proberesult"` |
| `nodewallet` | `str` | Wallet address of the probing node |
| `targeturl` | `str` | Target URL (max 128 bytes) |
| `timestamp` | `u64` | Unix timestamp in milliseconds |
| `reachable` | `bool` | `true` if probe succeeded |
| `geohash` | `str` | 5-6 char geohash of node location |
| `isp` | `str` | ISP name (max 128 bytes) |
| `networktype` | `str` | `"wifi"`, `"mobile"`, `"unknown"` |
| `blocktype` | `str` | `"dns_poisoning"`, `"tcp_reset"`, `"http_block"`, `"tls_interference"`, `"unreachable"`, or `""` |
| `httpstatus` | `i32` | HTTP status code, or `-1` if no response |
| `responsetimems` | `i32` | Response time in ms, or `-1` if no response |
| `prevresulthash` | `str` | Entity key of the previous probe from this node (chain) |
| `targetshash` | `str` | SHA-256 of the canonical target list (detect non-canonical nodes) |

**Payload (JSON):**
```json
{
  "id": "uuid-v4",
  "dnsPoisoned": true,
  "dnsExpected": ["104.244.42.193"],
  "dnsReceived": ["1.2.3.4"],
  "tcpConnected": false,
  "tcpRstInjected": false,
  "prevResultHash": "0x..."
}
```

**TTL:** 48 hours (`ExpirationTime.fromHours(48)`). High volume — fresh data is what matters for the live map. Older results naturally expire, keeping chain storage lean.

**Code:** [`packages/arkiv-sdk/src/client.ts#writeProbeResult`](../packages/arkiv-sdk/src/client.ts)

---

### 2. `volunteerproxy`

A live volunteer advertising WebRTC relay capacity via an SDP offer.

**Attributes (queryable):**

| Attribute | Type | Description |
|---|---|---|
| `project` | `str` | `"resist.net"` |
| `entitytype` | `str` | `"volunteerproxy"` |
| `wallet` | `str` | Volunteer's wallet address |
| `geohash` | `str` | 5-6 char geohash of volunteer location |
| `capacityslots` | `i32` | Max simultaneous users this volunteer accepts |
| `createdat` | `u64` | Unix timestamp in ms when offer was published |

**Payload:** Raw SDP offer JSON string (`{"type":"offer","sdp":"v=0\r\n..."}`)

**TTL:** 5 minutes (`ExpirationTime.fromMinutes(5)`). The volunteer re-extends every 4 minutes via `extendEntity`. When they go offline, the entry vanishes automatically — no stale directory, no admin cleanup.

**Code:** [`packages/arkiv-sdk/src/client.ts#writeVolunteerProxy`](../packages/arkiv-sdk/src/client.ts), [`packages/proxy-client/src/volunteer.ts`](../packages/proxy-client/src/volunteer.ts)

---

### 3. `nodeidentity`

A volunteer node's liveness signal and metadata. Acts as a heartbeat.

**Attributes (queryable):**

| Attribute | Type | Description |
|---|---|---|
| `project` | `str` | `"resist.net"` |
| `entitytype` | `str` | `"nodeidentity"` |
| `wallet` | `str` | Node wallet address |
| `geohash` | `str` | 5-6 char geohash |
| `isp` | `str` | ISP name |
| `networktype` | `str` | `"wifi"`, `"mobile"`, `"unknown"` |
| `lastseenms` | `u64` | Unix timestamp in ms of last check |

**Payload (JSON):**
```json
{ "capabilities": { "probe": true, "proxy": false } }
```

**TTL:** 30 minutes (`ExpirationTime.fromMinutes(30)`). Re-created every 15 minutes while the node is online. When offline, disappears from the active-nodes query automatically.

**Code:** [`packages/arkiv-sdk/src/client.ts#writeNodeIdentity`](../packages/arkiv-sdk/src/client.ts)

---

### 4. `signalexchange`

Ephemeral WebRTC handshake completion — censored user writes their SDP answer here for the volunteer to read.

**Attributes (queryable):**

| Attribute | Type | Description |
|---|---|---|
| `project` | `str` | `"resist.net"` |
| `entitytype` | `str` | `"signalexchange"` |
| `volunteerwallet` | `str` | Wallet of the volunteer being connected to |
| `clientwallet` | `str` | Wallet of the censored user |
| `createdat` | `u64` | Unix timestamp in ms |

**Payload:** SDP answer JSON string (`{"type":"answer","sdp":"v=0\r\n..."}`)

**TTL:** 2 minutes (`ExpirationTime.fromMinutes(2)`). One-shot signaling message. Auto-destructs whether or not the WebRTC handshake succeeds. The censored user also deletes it on connection success as best-effort cleanup.

**Code:** [`packages/arkiv-sdk/src/client.ts#writeSignalExchange`](../packages/arkiv-sdk/src/client.ts), [`packages/proxy-client/src/user.ts`](../packages/proxy-client/src/user.ts)

---

### 5. `probequeue`

A custom URL probe job — someone requests their URL probed by volunteers from specific regions.

**Attributes (queryable):**

| Attribute | Type | Description |
|---|---|---|
| `project` | `str` | `"resist.net"` |
| `entitytype` | `str` | `"probequeue"` |
| `requesterwallet` | `str` | Wallet that created the job |
| `targeturl` | `str` | URL to probe (max 128 bytes) |
| `volunteercount` | `i32` | Desired number of independent probes |
| `repeatcount` | `i32` | How many times to repeat |
| `intervalseconds` | `i32` | Seconds between repeats |
| `paymentglm` | `i32` | Payment in GLM millionths |
| `createdat` | `u64` | Unix timestamp in ms |
| `expiresat` | `u64` | Unix timestamp in ms when the job expires |

**Payload (JSON):** `{ "targetUrl": "https://example.com" }`

**TTL:** Dynamic — set to `expiresAt - now`, capped at 7 days.

**Code:** [`packages/arkiv-sdk/src/client.ts#writeProbeQueueEntry`](../packages/arkiv-sdk/src/client.ts)

---

## TTL Summary

| Entity | TTL | Reasoning |
|---|---|---|
| `proberesult` | 48 hours | High-volume; fresh data drives the live map |
| `volunteerproxy` | 5 min (renewed every 4 min) | Stale proxy = failed connection; auto-clean |
| `nodeidentity` | 30 min (renewed every 15 min) | Heartbeat replacement — gone = offline |
| `signalexchange` | 2 min | One-shot handshake signal; auto-destructs |
| `probequeue` | Up to 7 days | Lives until the job expires |

---

## Wallet Addresses

- **Volunteer proxy node (server):** `0x98Cc6a9c502A4bA4dE7322CCC5b32F0dc4064BbC` — writes `volunteerproxy` and `signalexchange` entities on Tiramisu testnet
- **Probe nodes:** auto-generated wallets per-device — each writes `proberesult` and `nodeidentity` entities

Explorer: [tiramisu.explorer.arkiv.network](https://tiramisu.explorer.arkiv.network)
