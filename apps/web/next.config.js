/** @type {import('next').NextConfig} */
const path = require('path')
const isDev = process.env.NODE_ENV !== 'production'

const arkivRpcOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_ARKIV_RPC_URL || process.env.ARKIV_RPC_URL
  if (!raw) return 'https://*.arkiv.network'
  try {
    const u = new URL(raw)
    return u.origin
  } catch {
    return 'https://*.arkiv.network'
  }
})()

const nextConfig = {
  transpilePackages: ['@resist/shared', '@resist/arkiv-sdk', '@resist/map-ui'],
  webpack: (config) => {
    // Resolve workspace symlinks correctly
    config.resolve.symlinks = true
    // Handle .js extension for TypeScript source files
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    }
    return config
  },
  // Server-only packages that shouldn't be bundled for client (Next 14 uses experimental.serverComponentsExternalPackages)
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'ngeohash'],
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
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // CSP: allow self-hosted assets + Stadia Maps tiles + Leaflet CSS from unpkg
          // script-src 'self' only — no inline scripts, no eval
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline' https://unpkg.com",
              "img-src 'self' data: https://tiles.stadiamaps.com",
              `connect-src 'self' https://tiles.stadiamaps.com ${arkivRpcOrigin}`,
              "font-src 'self'",
              "frame-src 'none'",
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
