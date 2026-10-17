'use client'

/**
 * Thin wrapper around usePrivy that supports a test-only override.
 *
 * In production this is a transparent pass-through to @privy-io/react-auth's usePrivy.
 *
 * In end-to-end tests, a test can set `window.__PRIVY_TEST_USER__` via page.addInitScript
 * to inject a fake authenticated user without needing a real Privy session.
 *
 * Only active when NODE_ENV !== 'production'. In production, the override path is dead code.
 */

import { usePrivy as usePrivyReal, type User, type WalletWithMetadata } from '@privy-io/react-auth'
import { useMemo } from 'react'

declare global {
  interface Window {
    __PRIVY_TEST_USER__?: {
      address: string
      chainType?: string
    } | null
  }
}

function useTestOverride() {
  // Read the override once. Tests set this before the page loads via addInitScript.
  return useMemo(() => {
    if (typeof window === 'undefined') return null
    if (process.env.NEXT_PUBLIC_E2E !== 'true' || process.env.NODE_ENV === 'production') return null
    return window.__PRIVY_TEST_USER__ ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export function usePrivy() {
  const real = usePrivyReal()
  const override = useTestOverride()

  if (override) {
    const chainType = (override.chainType ?? 'ethereum') as 'ethereum'
    const walletAccount: WalletWithMetadata = {
      type: 'wallet',
      address: override.address,
      chainType,
      walletClientType: 'metamask',
      connectorType: 'injected',
      imported: false,
      delegated: false,
      walletIndex: 0,
      firstVerifiedAt: null,
      latestVerifiedAt: null,
    }
    const mockUser: User = {
      id: 'did:privy:test-override',
      createdAt: new Date(0),
      wallet: {
        address: override.address,
        chainType,
        walletClientType: 'metamask',
        connectorType: 'injected',
        imported: false,
        delegated: false,
        walletIndex: 0,
      },
      linkedAccounts: [walletAccount],
      mfaMethods: [],
      hasAcceptedTerms: false,
      isGuest: false,
    }
    return {
      ...real,
      ready: true,
      authenticated: true,
      user: mockUser,
    }
  }

  return real
}
