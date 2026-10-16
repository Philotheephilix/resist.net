import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'resist.net — Community Censorship Monitor',
  description: 'Real-time map of internet censorship events contributed by volunteers worldwide',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
