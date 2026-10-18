# resist-proxy

Volunteer proxy node for [ResistNet](https://resist-net.vercel.app) — routes censored traffic through WebRTC peer connections.

## Usage

**Run as a volunteer** (uncensored connection, exits traffic for others):
```sh
npx resist-proxy volunteer
```

**Run as a censored user** (connects through a volunteer, opens local HTTP proxy):
```sh
npx resist-proxy user
```

When user mode connects:
```
Proxy ready on 127.0.0.1:8080 via volunteer 0xABC...
```

## Wire to a browser

**Chrome:**
```sh
open -a "Google Chrome" --args --proxy-server="http://127.0.0.1:8080"
```

**Firefox:** Settings → Network Settings → Manual proxy → HTTP Proxy: `127.0.0.1` Port: `8080`

**macOS system-wide:** System Settings → Network → Proxies → Web Proxy → `127.0.0.1:8080`

## Options

```
resist-proxy volunteer|user [--wallet=<addr>] [--geohash=<hash>] [--rpcUrl=<url>] [--backendUrl=<url>]
```

## Environment variables

| Variable | Description |
|---|---|
| `ARKIV_RPC_URL` | Arkiv RPC endpoint (defaults to testnet) |
| `RESIST_BACKEND_URL` | ResistNet backend URL (defaults to resist-net.vercel.app) |
| `DEV_PRIVATE_KEY` | Override auto-generated wallet private key |
| `GEOHASH` | Fallback geohash when ip-api.com is unreachable |

## Links

- Dashboard: [resist-net.vercel.app](https://resist-net.vercel.app)
- Repo: [github.com/Philotheephilix/resist.net](https://github.com/Philotheephilix/resist.net)
- Probe node: [npmjs.com/package/resist-probe](https://www.npmjs.com/package/resist-probe)
