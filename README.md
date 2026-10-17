# resist.net

Censorship-resistance monitoring network. A monorepo containing the web dashboard, probe node daemon, and shared libraries.

## Packages

| Package | Description |
|---|---|
| `apps/web` | Next.js dashboard — displays probe results on a world map |
| `packages/probe-node` | Daemon that runs HTTP/DNS/TCP checks and writes results to Arkiv |
| `packages/arkiv-sdk` | Client library for the Arkiv ingest/query API |
| `packages/shared` | Shared TypeScript types |
| `packages/proxy-client` | Proxy client utilities |
| `packages/map-ui` | Shared map UI components |

## Prerequisites

- Node.js >= 18 (current: v26 tested)
- npm >= 9 (ships with Node 18+)
- [turbo](https://turbo.build/) — installed automatically as a dev dependency

## Setup

Install all workspace dependencies from the repo root:

```sh
npm install
```

## Running the web app locally

1. Create `apps/web/.env.local` with the required environment variable:

   ```sh
   # URL of the Arkiv JSON-RPC endpoint
   ARKIV_RPC_URL=https://arkiv.resist.net

   # Optional: sets the allowed connect-src origin in the Content-Security-Policy header.
   # Defaults to https://*.arkiv.network when unset.
   NEXT_PUBLIC_ARKIV_RPC_URL=https://arkiv.resist.net
   ```

2. Start the Next.js development server:

   ```sh
   npm run dev --workspace=apps/web
   # or via turbo (starts all dev targets):
   npx turbo run dev
   ```

   The app is available at `http://localhost:3000`.

## Running probe-node locally (pointing at the dev stack)

Install the probe globally or run it directly with `npx`:

```sh
# Run a single probe tick against the local dev Arkiv endpoint and exit
ARKIV_URL=http://localhost:3000/api/ingest npx @resist/probe-node --once
```

See [`packages/probe-node/README.md`](packages/probe-node/README.md) for the full list of probe-node environment variables and usage examples.

## Build

Build all packages:

```sh
npx turbo run build
```

## Tests

End-to-end tests use Playwright:

```sh
npm test
```
