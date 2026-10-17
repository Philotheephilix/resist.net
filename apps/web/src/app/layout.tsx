import type { Metadata, Viewport } from 'next'
import './globals.css'
import PrivyProviderWrapper from '../components/PrivyProviderWrapper'

export const metadata: Metadata = {
  title: 'ResistNet — Network Radar',
  description: 'Live network observability, probe history, and resilient routing.',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'ResistNet — Network Radar',
    description: 'Live network observability, probe history, and resilient routing.',
    url: 'https://resist.net',
    siteName: 'ResistNet',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ResistNet — Network Radar',
    description: 'Live network observability, probe history, and resilient routing.',
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PrivyProviderWrapper>{children}</PrivyProviderWrapper>
      </body>
    </html>
  )
}
