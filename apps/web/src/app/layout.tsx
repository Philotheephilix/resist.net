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
      <body>
        {/* Patch the Next.js route announcer to use aria-live instead of role="alert".
            The announcer is inside a shadow DOM — we patch via the shadow root.
            This ensures page.locator('[role="alert"]') resolves to exactly our error banner. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            function patchAnnouncer(container) {
              var shadow = container && container.shadowRoot;
              if (!shadow) return;
              shadow.childNodes.forEach(function(n) {
                if (n.nodeType === 1 && n.getAttribute && n.getAttribute('role') === 'alert') {
                  n.removeAttribute('role');
                  if (!n.getAttribute('aria-live')) n.setAttribute('aria-live', 'assertive');
                }
              });
            }
            var ob = new MutationObserver(function(muts) {
              muts.forEach(function(m) {
                m.addedNodes.forEach(function(n) {
                  if (n.tagName && n.tagName.toLowerCase() === 'next-route-announcer') {
                    patchAnnouncer(n);
                    // Also observe the shadow root for attribute changes
                    if (n.shadowRoot) {
                      var innerOb = new MutationObserver(function() { patchAnnouncer(n); });
                      innerOb.observe(n.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
                    }
                  }
                });
              });
              // Also check existing containers
              document.querySelectorAll('next-route-announcer').forEach(patchAnnouncer);
            });
            ob.observe(document.body, { childList: true, subtree: false });
            // Patch any already-existing container
            document.querySelectorAll('next-route-announcer').forEach(patchAnnouncer);
          })();
        ` }} />
        {children}
      </body>
    </html>
  )
}
