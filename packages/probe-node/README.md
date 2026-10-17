# @resist/probe-node

Probe node for resist.net. Runs HTTP, DNS, and TCP censorship checks against a fixed list of well-known URLs on a 15-minute schedule, signs results with an auto-generated wallet, and writes them to an Arkiv ingest endpoint. Falls back to a local SQLite cache when the endpoint is unreachable.

## Installation

```sh
npm install -g @resist/probe-node
```

## Environment variables

| Variable            | Required | Description                                                                 |
|---------------------|----------|-----------------------------------------------------------------------------|
| `ARKIV_URL`         | Yes      | URL of the Arkiv ingest endpoint, e.g. `https://arkiv.resist.net/ingest`   |
| `WALLET_PRIVATE_KEY`| No       | Override the auto-generated wallet private key                              |
| `HEALTHZ_PORT`      | No       | Port for the `/healthz` HTTP health endpoint (default: `9090`)              |
| `GEOHASH`           | No       | Fallback geohash when ip-api.com is unreachable (default: `ttnnm77`)        |
| `ISP`               | No       | Fallback ISP name when ip-api.com is unreachable (default: `unknown`)       |

## Usage

```sh
# Run continuously on a 15-minute schedule (default mode)
ARKIV_URL=https://arkiv.resist.net/ingest resist-probe

# Run a single probe tick and exit
ARKIV_URL=https://arkiv.resist.net/ingest resist-probe --once

# Probe a single URL once and exit
ARKIV_URL=https://arkiv.resist.net/ingest resist-probe --target=https://example.com

# Print help
resist-probe --help
```

## Health endpoint

When running in continuous mode the process exposes a health endpoint on `HEALTHZ_PORT` (default 9090):

```
GET http://localhost:9090/
```

Response:

```json
{ "status": "ok", "pending_rows": 0, "threshold": 500 }
```

`status` is `"degraded"` and the response code is `503` when the offline SQLite cache exceeds 500 rows, which indicates the Arkiv endpoint has been unreachable for an extended period.

## Verifying the probe

**Smoke-test before deploying the daemon**

Run a single tick with `--once` and confirm exit code 0:

```sh
ARKIV_URL=https://arkiv.resist.net/ingest resist-probe --once
echo $?   # should print 0
```

Probe a single URL to check connectivity to a specific target:

```sh
ARKIV_URL=https://arkiv.resist.net/ingest resist-probe --once --target=https://example.com
```

**Expected log output on a successful tick**

A working probe logs `[sync]` lines when results are flushed to Arkiv:

```
[probe] tick started
[probe] http https://example.com 200 42ms
...
[sync] flushed 10 rows to Arkiv
```

If Arkiv is unreachable the sync line is replaced by a cache line:

```
[sync] Arkiv unreachable — cached 10 rows (total pending: 10)
```

**Check the health endpoint for pending rows**

With the daemon running, query the health endpoint. `pending_rows: 0` confirms all results have reached Arkiv:

```sh
curl http://localhost:9090/
# {"status":"ok","pending_rows":0,"threshold":500}
```

`pending_rows` greater than 0 means rows are queued in the local SQLite cache at `~/.resist-net/cache.db`. Rows are retried automatically on the next tick once Arkiv is reachable again.

**Inspect the SQLite offline cache directly**

```sh
sqlite3 ~/.resist-net/cache.db "SELECT COUNT(*) FROM results WHERE synced = 0;"
```

A count of 0 confirms no rows are waiting to be flushed.

**Query Arkiv for results submitted by this node**

Find the node's wallet address in the config file:

```sh
cat ~/.resist-net/config.json | grep walletAddress
```

Then query the Arkiv API with that address:

```sh
curl "https://arkiv.resist.net/results?wallet=0xYOUR_WALLET_ADDRESS&limit=5"
```

## Testing

End-to-end tests for the resist.net web app are written with [Playwright](https://playwright.dev/) and live in `e2e/app.spec.ts` at the repo root.

**Run E2E tests**

Start the dev server first, then run the suite in a second terminal:

```sh
# Terminal 1 — start the Next.js dev server on port 3001
pnpm dev

# Terminal 2 — run all Playwright tests against localhost:3001
pnpm test
```

To run tests against mock data without a live Arkiv endpoint, set `USE_MOCK_DATA=true`:

```sh
USE_MOCK_DATA=true pnpm dev
```

**Environment variables used during tests**

| Variable         | Required | Description                                              |
|------------------|----------|----------------------------------------------------------|
| `USE_MOCK_DATA`  | No       | Set to `true` to skip Arkiv and serve synthetic events   |
| `ARKIV_URL`      | No       | Live Arkiv endpoint; omit when `USE_MOCK_DATA=true`      |

**What the tests cover**

- Page title, dark theme, and header rendering
- Filter pill rendering, keyboard navigation, and active-state toggling
- Sidebar show/hide with focus management and `aria-expanded` state
- Map container, tile layer, marker popups, and Escape-to-close behaviour
- API routes: `/api/probe-events` (filters, stats, geohash), `/api/bootstrap`, error and rate-limit responses
- Accessibility: skip-nav links, live regions, loading overlays, responsive layout at 375 px / 768 px / 1280 px

## Configuration

On first start a wallet and config file are created at `~/.resist-net/config.json` (mode `0600`). The wallet address and private key are generated locally and never transmitted. The config is updated on each startup with the latest geohash and ISP detected via ip-api.com.
