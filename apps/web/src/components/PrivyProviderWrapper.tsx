'use client'

import { PrivyProvider } from '@privy-io/react-auth'

const appId = (process.env['NEXT_PUBLIC_PRIVY_APP_ID'] ?? '') as string

export default function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'light',
          accentColor: '#19b955',
          logo: '/icon.svg',
          showWalletLoginFirst: true,
        },
        embeddedWallets: {},
      }}
    >
      {children}
    </PrivyProvider>
  )
}
