'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useSyncExternalStore } from 'react'
import BlockEventList from '../components/BlockEventList'
import FilterBar, { FilterType } from '../components/FilterBar'
import NodeCount from '../components/NodeCount'
import { useBlockEvents } from '../hooks/useBlockEvents'

// Hoisted static style objects — stable identity avoids recreating them on every render.
const SIDEBAR_BTN_STATIC: React.CSSProperties = {
  color: 'var(--wld-gray-300)',
  border: '1px solid var(--wld-glass-border-focus)',
}
const LOADING_PILL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--wld-surface-elevated)',
  color: 'var(--wld-gray-300)',
  border: '1px solid var(--wld-glass-border-focus)',
}
const LOADING_DOT_STYLE: React.CSSProperties = { backgroundColor: 'var(--wld-success-600)' }
const STATUS_VISIBLE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--wld-surface-elevated)',
  color: 'var(--wld-gray-300)',
  border: '1px solid var(--wld-glass-border-focus)',
  zIndex: 5,
  pointerEvents: 'none',
}
const STATUS_HIDDEN_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

// Leaflet must be client-only — no SSR
const CensorshipMap = dynamic(() => import('../components/CensorshipMap'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Loading map"
      className="flex h-full w-full items-center justify-center"
      style={{ backgroundColor: 'var(--wld-gray-900)' }}
    >
      <span style={{ color: 'var(--wld-gray-400)', fontSize: 14 }}>Loading map…</span>
    </div>
  ),
})

// Track whether we're on a small (mobile) viewport where sm:hidden is inactive.
// This lets us set aria-hidden on the mobile bottom sheet when it's CSS-hidden on desktop.
// mq is created once at module level — window.matchMedia() allocates a MediaQueryList
// object; calling it inside getSnapshot() (which fires on every render) would allocate
// a new instance on every render and leak listeners.
let mq: MediaQueryList | undefined
function getMq(): MediaQueryList {
  if (!mq) mq = window.matchMedia('(min-width: 640px)')
  return mq
}
function subscribe(cb: () => void) {
  getMq().addEventListener('change', cb)
  return () => getMq().removeEventListener('change', cb)
}
function getSnapshot() { return getMq().matches }
function getServerSnapshot() { return false }

export default function HomePage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const { events, loading, error } = useBlockEvents({
    blockType: activeFilter === 'all' ? undefined : activeFilter,
  })

  // Single-pass memoized counts — avoids two O(N) array traversals per render
  const { blockedCount, reachableCount } = useMemo(() => {
    let blockedCount = 0
    let reachableCount = 0
    for (const e of events) {
      if (e.blockType !== null) blockedCount++
      if (e.reachable) reachableCount++
    }
    return { blockedCount, reachableCount }
  }, [events])

  // Hoist sort+slice — BlockEventList is mounted twice (sidebar + mobile sheet).
  // Pre-computing once here avoids two independent O(N log N) sorts per poll cycle.
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    [events]
  )

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--wld-gray-900)', color: 'var(--wld-gray-0)' }}
    >
      {/* ─── Top bar ──────────────────────────────────────────── */}
      <header
        className="z-10 flex flex-shrink-0 items-center justify-between gap-4 px-4 py-3"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--wld-bg-primary) 92%, transparent)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--wld-glass-border)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
            style={{ backgroundColor: 'var(--wld-error-600)', color: 'var(--wld-gray-0)' }}
            aria-hidden
          >
            R
          </div>
          <div>
            <h1
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--wld-gray-0)', margin: 0 }}
            >
              resist.net
            </h1>
            <span
              className="ml-2 hidden text-xs sm:inline"
              style={{ color: 'var(--wld-gray-400)' }}
            >
              Community Censorship Monitor
            </span>
          </div>
        </div>

        {/* Stats + sidebar toggle */}
        <div className="flex items-center gap-3">
          <NodeCount />
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              ...SIDEBAR_BTN_STATIC,
              backgroundColor: sidebarOpen ? 'var(--wld-glass-bg-active)' : 'var(--wld-glass-bg-faint)',
            }}
            aria-label={sidebarOpen ? 'Hide events panel' : 'Show events panel'}
            aria-expanded={sidebarOpen}
            aria-controls="events-panel"
          >
            {sidebarOpen ? 'Hide' : 'Events'}
          </button>
        </div>
      </header>

      {/* ─── Filter bar ───────────────────────────────────────── */}
      <div
        className="z-10 flex-shrink-0 px-4 py-2"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--wld-bg-primary) 88%, transparent)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--wld-glass-border-subtle)',
        }}
      >
        <FilterBar active={activeFilter} onChange={setActiveFilter} />
      </div>

      {/* ─── Main content area ────────────────────────────────── */}
      <main className="relative flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative flex-1">
          <CensorshipMap events={events} sidebarOpen={sidebarOpen} />

          {/* Error banner — role=alert container always in DOM so AT registers the
              live region before the first error fires. Some AT (JAWS, older VoiceOver)
              miss announcements when the element is injected already containing text.
              The visible styled content is a child; we show/hide it via visibility. */}
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="absolute left-4 right-4 top-4"
            style={{ zIndex: 10, pointerEvents: error ? undefined : 'none' }}
          >
            {error && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs"
                style={{
                  backgroundColor: 'var(--wld-error-100)',
                  border: '1px solid var(--wld-error-600)',
                  color: 'var(--wld-error-700)',
                  animation: 'slideInFromTop 300ms cubic-bezier(0,0,0.2,1)',
                }}
              >
                <span aria-hidden>⚠</span>
                Failed to load events: {error}
              </div>
            )}
          </div>

          {/* Loading overlay on map — always in DOM so the role=status live region
              is registered by AT before the first announcement fires.
              Visually hidden when not loading via aria-hidden + pointer-events:none. */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor: loading && events.length === 0 ? 'var(--wld-overlay)' : 'transparent',
              zIndex: loading && events.length === 0 ? 5 : -1,
              pointerEvents: loading && events.length === 0 ? undefined : 'none',
            }}
            role="status"
            aria-label="Loading probe events"
            aria-hidden={loading && events.length === 0 ? undefined : 'true'}
          >
            {loading && events.length === 0 && (
              <div className="flex items-center gap-2 rounded-full px-4 py-2 text-xs" style={LOADING_PILL_STYLE}>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={LOADING_DOT_STYLE} />
                Fetching probe events…
              </div>
            )}
          </div>

          {/* Event count live region — single persistent element, always mounted so AT
              registers the aria-live region on first render. Content swaps in-place;
              we never unmount/remount the node (which would silently drop announcements
              because AT does not retroactively register newly inserted live regions).
              When no data yet: visually hidden via sr-only equivalent so the empty
              string does not produce a visible badge. */}
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={!loading && events.length > 0
              ? 'absolute bottom-4 left-4 rounded-full px-3 py-1.5 text-xs font-semibold'
              : undefined}
            style={!loading && events.length > 0 ? STATUS_VISIBLE_STYLE : STATUS_HIDDEN_STYLE}
          aria-label={!loading && events.length > 0
            ? `${blockedCount} blocked, ${reachableCount} reachable`
            : undefined}
          >
            {!loading && events.length > 0
              ? <>{blockedCount} blocked<span aria-hidden="true"> • </span>{reachableCount} reachable</>
              : ''}
          </div>
        </div>

        {/* Sidebar — events list. Skip link (in CensorshipMap) only renders
            when sidebarOpen=true, so the anchor target is always visible when
            the link is present — no broken anchor navigation. */}
        <aside
          id="events-panel"
          aria-label="Recent block events"
          // aria-hidden must be omitted (not set to false) when the element is
          // visible — ARIA 1.2 SHOULD NOT set aria-hidden=false on elements with
          // focusable descendants. When hidden, display:none already removes the
          // element from the AT tree, so aria-hidden="true" would be redundant;
          // we rely on display:none alone for AT hiding when sidebarOpen=false.
          {...(!sidebarOpen ? { 'aria-hidden': 'true' as const } : {})}
          className="flex w-80 flex-col flex-shrink-0 overflow-hidden"
          style={{
            display: sidebarOpen ? undefined : 'none',
            backgroundColor: 'var(--wld-bg-primary)',
            borderLeft: '1px solid var(--wld-glass-border-strong)',
          }}
        >
          <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />
        </aside>
      </main>

      {/* ─── Mobile bottom sheet (small screens) ─────────────── */}
      {/* aria-hidden is false when sidebar is closed — that's when mobile users
          rely on this sheet. When sidebar is open (desktop layout) the sheet is
          visually hidden by sm:hidden, so we hide it from AT too. */}
      {/* Mobile bottom sheet — hidden via sm:hidden (CSS) on desktop.
          aria-hidden when desktop (isDesktop=true, sm:hidden applies) to prevent
          AT traversal of the visually-hidden duplicate content. Also hidden when
          sidebar is open on mobile (sidebarOpen=true) since the sidebar serves the
          same content and both panels being AT-accessible would duplicate content. */}
      <div
        role="region"
        className="flex-shrink-0 sm:hidden"
        aria-label="Recent block events (mobile)"
        aria-hidden={isDesktop || sidebarOpen ? 'true' : undefined}
        style={{ borderTop: '1px solid var(--wld-glass-border-strong)' }}
      >
        <div
          className="max-h-56 overflow-y-auto"
          style={{ backgroundColor: 'var(--wld-bg-primary)' }}
        >
          <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />
        </div>
      </div>
    </div>
  )
}
