import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'resist.net — Community Censorship Monitor',
  description: 'Real-time map of internet censorship events contributed by volunteers worldwide',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'resist.net — Community Censorship Monitor',
    description: 'Real-time map of internet censorship events contributed by volunteers worldwide',
    url: 'https://resist.net',
    siteName: 'resist.net',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'resist.net — Community Censorship Monitor',
    description: 'Real-time map of internet censorship events contributed by volunteers worldwide',
    images: ['/og.png'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
