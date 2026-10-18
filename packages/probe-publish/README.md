# resist-probe

Volunteer censorship probe node for [ResistNet](https://github.com/Philotheephilix/resist.net) — runs HTTP, DNS, and TCP probes every 15 minutes, signs results with a wallet, and writes them to the Arkiv testnet.

Live dashboard: https://resist-net.vercel.app

## Install & Run

```sh
# Single probe tick
npx resist-probe --once

# Continuous (probes every 15 min)
npx resist-probe
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--once` | Run one probe cycle and exit |
| `--target=<url>` | Override the default target URL |
| `--dry-run` | Run probes but do not write results on-chain |
| `--verbose` | Print detailed probe output |
| `--help` | Show usage |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WALLET_PRIVATE_KEY` | Private key used to sign probe results |
| `ARKIV_URL` | Arkiv HTTP endpoint (defaults to testnet) |
| `ARKIV_RPC_URL` | Arkiv JSON-RPC endpoint (defaults to testnet) |
| `GEOHASH` | Your approximate location geohash (optional) |
| `ISP` | Your ISP name (optional, aids censorship analysis) |

## What It Does

1. Every 15 minutes (or on `--once`): performs HTTP reachability, DNS resolution, and TCP connect probes against configured targets.
2. Signs the probe result bundle with your wallet private key.
3. Submits the signed result to Arkiv testnet, creating a tamper-evident censorship record.
4. Anyone can verify results via the live dashboard.

## Links

- Main repo: https://github.com/Philotheephilix/resist.net
- Live dashboard: https://resist-net.vercel.app
- npm: https://www.npmjs.com/package/resist-probe
