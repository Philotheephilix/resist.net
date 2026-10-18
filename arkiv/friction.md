# ResistNet — Arkiv Friction Report

SDK version: `@arkiv-network/sdk` 0.8.x  
Network: Tiramisu testnet (chain ID 7738577)  
Built: October 9–18, 2026

---

## 1. Attribute names must be lowercase — error message is cryptic

**Expected:** Attribute names can use camelCase or mixed case (standard in TypeScript/JSON).

**What happened:** Writing an entity with `nodeWallet: addr("0x...")` failed with `Ident32InvalidByte`. The error gives you a byte offset but not the attribute name, so you have to binary-search your attribute map to find the offending key.

**Versions:** `@arkiv-network/sdk@0.8.x`

**Steps to reproduce:**
```typescript
await walletClient.createEntity({
  attributes: { nodeWallet: str("0xabc") }, // camelCase — fails
  // ...
})
// Error: Ident32InvalidByte at byte 4
```

**Fix we applied:** All attribute names lowercased in `packages/arkiv-sdk/src/client.ts`. Had to audit every attribute call after discovering this.

**Suggestion:** Validate attribute names client-side before the RPC call and surface `"attribute 'nodeWallet' contains uppercase character — use lowercase only"`.

---

## 2. `ne`, `exists`, `hasType` predicates not supported on Tiramisu

**Expected:** `ne("country", "IN")` works — it's exported from `@arkiv-network/sdk/query`.

**What happened:** The Tiramisu node rejects `ne` / `exists` / `hasType` predicates at query time with a runtime error. The SDK exports them; the chain doesn't support them.

**Versions:** `@arkiv-network/sdk@0.8.x`

**Steps to reproduce:**
```typescript
const result = await publicClient
  .select({ attributes: true })
  .where(ne("country", "IN"))
  .fetch()
// Runtime error from node
```

**Fix we applied:** All exclusion filtering moved client-side. For volunteer geohash exclusion: query all volunteers, then filter the array in JS.

**Suggestion:** Either remove `ne`/`exists`/`hasType` from the SDK exports on Tiramisu builds, or add a clear note in the docs that these are unsupported on testnet. Discovering this only at runtime cost significant debug time.

---

## 3. `u64` requires `BigInt`, not `number` — silent wrong behavior with bare numbers

**Expected:** `u64(1792252052)` for a Unix timestamp in seconds works.

**What happened:** `u64(1792252052)` silently accepted the bare number but stored a wrong value — queries with `gte("timestamp", u64(since))` returned inconsistent results. The issue: millisecond timestamps (e.g. `Date.now()` = `1792252052000`) overflow `i32` range, and bare numbers are treated as `i32` internally before the `u64` wrapper.

**Versions:** `@arkiv-network/sdk@0.8.x`

**Steps to reproduce:**
```typescript
// Bug: number coerced to i32 before u64 wrapping
u64(Date.now()) // Date.now() is ~1.7e12, overflows i32

// Fix:
u64(BigInt(Date.now()))
```

**Fix we applied:** All `u64()` calls use `u64(BigInt(...))` explicitly throughout `client.ts`.

**Suggestion:** `u64(n: number | bigint)` — if `n > 2^31`, throw `"u64(): value overflows i32; pass BigInt(n) instead"`.

---

## 4. `extendEntity` requires exact `0x{64 hex chars}` key — no validation at call time

**Expected:** Pass the entity key returned by `createEntity` directly to `extendEntity`.

**What happened:** `createEntity` returns `entityKey` typed as `string`. Passing it to `extendEntity` requires casting to `` `0x${string}` ``. If the key is empty string or malformed (e.g., from a failed write that swallowed the error), `extendEntity` silently succeeds but does nothing — or throws an unhelpful RPC error.

**Fix we applied:** Regex-validate entity keys before any `extendEntity` / `deleteEntity` call:
```typescript
if (!/^0x[0-9a-fA-F]{64}$/.test(entityKey)) throw new Error("invalid entityKey")
```

**Suggestion:** Validate the key format in `extendEntity` / `deleteEntity` / `patchEntity` and throw descriptively before the RPC round-trip.

---

## 5. No way to query by payload content — forced dual-storage

**Expected:** Query `where(eq("sdp.type", "offer"))` or similar to filter by payload field.

**What happened:** Payload is opaque — queryable only through attributes. For `volunteerproxy`, the SDP offer is large (1–2KB) and must be stored in the payload, but we also need to distinguish offer type. Had to add a `entitytype: "volunteerproxy"` attribute that duplicates what could be a payload field.

**Impact:** Minor — just adds one attribute per entity. But it means any data you want to filter on must be duplicated into attributes, even if it's already structured in the payload.

**Suggestion:** Documented limitation — acceptable design tradeoff. Just worth calling out explicitly in the docs.

---

## 6. Faucet UX — wallet funding not obvious for fresh wallets

**Expected:** A node that auto-generates a fresh wallet can fund it quickly for testing.

**What happened:** Each probe node and proxy node generates a random wallet on first run. Getting testnet GLM to each wallet required going to the faucet separately. With multiple test nodes running, this became a repeated friction point. The faucet URL isn't surfaced in the SDK error when a write fails due to insufficient funds.

**Fix we applied:** Funded the volunteer server wallet manually by transferring from a locally-funded wallet via ethers.js:
```
TX: 0x3e592295eb66ed8fd72a1b4879fb4ee485c56ea43009221ce906ca9e349bc2f5
```

**Suggestion:** When `createEntity` fails with an insufficient-funds error, include the faucet URL in the error message: `"Insufficient funds. Fund this wallet at: https://faucet.tiramisu..."`.

---

## 7. WebSocket RPC endpoint not stable during development

**Expected:** `wss://rpc.tiramisu.db-chain.testnet.arkiv.network` works reliably for `watchEntityEvents`.

**What happened:** The WebSocket endpoint disconnected intermittently during a 2-hour development session. The polling fallback (`pollingInterval: 2000`) worked correctly but meant real-time dashboard updates had 2-second lag.

**Versions:** Tested October 14–17, 2026.

**Suggestion:** Expose a reconnect/backoff config option on `watchEntityEvents`, or document the recommended reconnection pattern.

---

## What worked well

- The `ExpirationTime` helpers (`fromMinutes`, `fromHours`, etc.) are excellent — natural to write, obvious semantics.
- `extendEntity` as a "renew TTL" operation is exactly the right primitive for the volunteer heartbeat pattern.
- The SDK TypeScript types are good — caught several attribute type mismatches at compile time.
- Query builder API (`select().where(and([...])).limit().fetch()`) is clean and composable.
- The Hub at `hub.arkiv.network` was useful for verifying entities were actually written.
