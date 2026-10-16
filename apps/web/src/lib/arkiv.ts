// Re-export the SDK client for server-side use in API routes.
// Client-side code should NOT import this — it contains private key usage.
export { ArkivClient } from '@resist/arkiv-sdk/src/client.js'
export type { ArkivClientConfig } from '@resist/arkiv-sdk/src/client.js'
