/** @type {import('next').NextConfig} */
const path = require('path')
const isDev = process.env.NODE_ENV !== 'production'

const arkivRpcOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_ARKIV_RPC_URL || process.env.ARKIV_RPC_URL
  if (!raw) return 'https://arkiv.resist.net'
  try {
    const u = new URL(raw)
    return u.origin
  } catch {
    return 'https://arkiv.resist.net'
  }
})()

// Privy optional peer deps we don't want to install — skip bundling them
const PRIVY_OPTIONAL_PEERS = [
  '@farcaster/mini-app-solana',
  '@farcaster/frame-sdk',
  '@solana-program/memo',
  '@solana-program/system',
  '@solana-program/token',
  '@solana/kit',
  'permissionless',
  '@abstract-foundation/agw-client',
  '@reown/appkit',
  '@reown/appkit-adapter-wagmi',
  '@reown/appkit-adapter-ethers',
]

const nextConfig = {
  transpilePackages: ['@resist/shared', '@resist/arkiv-sdk', '@resist/map-ui'],
  turbopack: {},
  serverExternalPackages: ['better-sqlite3', 'ngeohash'],
  webpack: (config) => {
    config.resolve.symlinks = true
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    const prevExternals = config.externals || []
    config.externals = [
      ...(Array.isArray(prevExternals) ? prevExternals : [prevExternals]),
      ({ request }, callback) => {
        if (PRIVY_OPTIONAL_PEERS.includes(request)) return callback(null, `commonjs ${request}`)
        callback()
      },
    ]
    return config
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent MIME-sniffing attacks — browser must respect Content-Type
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Disallow framing — prevents clickjacking
          { key: 'X-Frame-Options', value: 'DENY' },
          // Force HTTPS for 1 year on all subdomains
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // CSP: allow self-hosted assets + Stadia Maps tiles + Leaflet CSS from unpkg
          // script-src 'self' only — no inline scripts, no eval
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self'${isDev ? " 'unsafe-inline'" : ''}`,
              "style-src 'self' 'unsafe-inline' https://unpkg.com",
              "img-src 'self' data: https://tiles.stadiamaps.com",
              `connect-src 'self' https://tiles.stadiamaps.com ${arkivRpcOrigin} https://auth.privy.io`,
              "font-src 'self'",
              "frame-src 'none' https://auth.privy.io",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
