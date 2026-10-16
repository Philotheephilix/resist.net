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

## Configuration

On first start a wallet and config file are created at `~/.resist-net/config.json` (mode `0600`). The wallet address and private key are generated locally and never transmitted. The config is updated on each startup with the latest geohash and ISP detected via ip-api.com.
