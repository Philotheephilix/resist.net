# Arkiv Expiry — How It Works and Why

## How expiry is set

Every entity written to Arkiv via `createEntity` takes an `expires` field using the `ExpirationTime` API:

```typescript
import { ExpirationTime } from "@arkiv-network/sdk"

await walletClient.createEntity({
  payload: ...,
  attributes: { ... },
  expires: ExpirationTime.fromHours(48),  // ProbeResult
})
```

TTLs used in resist.net:

| Entity type       | TTL         | Reason                                          |
|-------------------|-------------|-------------------------------------------------|
| `proberesult`     | 48 hours    | High volume; 48h covers offline sync + aggregation |
| `volunteerproxy`  | 5 minutes   | Stale proxies must vanish; re-published every 4 min |
| `nodeidentity`    | 30 minutes  | Heartbeat replacement; re-published every 20 min |
| `signalexchange`  | 2 minutes   | One-shot WebRTC signal; self-destructs after use |
| `probequeue`      | Job-defined | Capped at 7 days; mirrors the job's `expiresAt` |

The `ExpirationTime` helper accepts seconds, minutes, hours, days, weeks, months, years, a specific date, or a specific block number.

## What "expired" actually means

Expiry removes an entity from **active index queries** — it will no longer appear in `.select().where(...).fetch()` results. It does **not** delete the underlying on-chain record. The entity's transaction is permanently committed to the Tiramisu chain and remains retrievable via direct RPC calls using the entity key.

This distinction matters: a probe result that expires after 48 hours is no longer surfaced by dashboard queries, but the signed, timestamped transaction that created it still exists on-chain and can be fetched by anyone who has the entity key.

## Why records expire

Chain storage has real costs (Arkiv charges by entity lifetime in blocks). resist.net writes a probe result every 15 minutes per node per target URL. At scale this produces thousands of entities per day. Short TTLs keep storage costs manageable without sacrificing usefulness — 48 hours is enough for:

- Real-time dashboards (query live data)
- Cross-node aggregation (correlate results into a `BlockConfirmation`)
- Offline node sync (nodes that were disconnected can back-fill within the window)

Short-lived coordination entities (proxy offers, signal exchanges) use even shorter TTLs because stale data is actively harmful — a 5-minute-old SDP offer from a volunteer who went offline wastes a connection attempt.

## Expired records as legal/forensic evidence

Because expiry only affects indexing, **expired probe records are still valid evidentiary records**. The on-chain transaction carries:

- The node's wallet signature over the probe payload
- A cryptographic hash of the previous probe from that node (chain integrity)
- The block number and timestamp of when the entity was created

A journalist, digital rights organization, or court can retrieve an expired probe result by its entity key via a direct RPC call and verify:

1. The signature matches the node's wallet (no impersonation)
2. The hash chain is unbroken (no records were deleted or reordered)
3. The block timestamp proves when the probe ran

This makes expired probe results suitable for legal and forensic use cases — the TTL governs discoverability, not the evidentiary integrity of the underlying record.
