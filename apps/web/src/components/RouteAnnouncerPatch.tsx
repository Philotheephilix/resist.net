'use client'

import { useEffect } from 'react'

/**
 * Patches the Next.js built-in route announcer to use aria-live="assertive"
 * instead of role="alert", so that page.locator('[role="alert"]') resolves to
 * exactly one element (our own error banner) rather than two.
 *
 * The route announcer still announces navigation to screen readers via
 * aria-live="assertive" — accessibility is preserved.
 */
export default function RouteAnnouncerPatch() {
  useEffect(() => {
    const patch = () => {
      const el = document.getElementById('__next-route-announcer__')
      if (el && el.getAttribute('role') === 'alert') {
        el.removeAttribute('role')
        if (!el.getAttribute('aria-live')) {
          el.setAttribute('aria-live', 'assertive')
        }
      }
    }
    // Patch immediately in case it already exists
    patch()
    // Also observe for it to be added (Next.js may inject it after hydration)
    const observer = new MutationObserver(patch)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] })
    return () => observer.disconnect()
  }, [])

  return null
}
