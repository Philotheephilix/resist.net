'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useSyncExternalStore } from 'react'
import BlockEventList from '../components/BlockEventList'
import FilterBar, { FilterType } from '../components/FilterBar'
import NodeCount from '../components/NodeCount'
import { useBlockEvents } from '../hooks/useBlockEvents'

// Hoisted static style objects — stable identity avoids recreating them on every render.
const SIDEBAR_BTN_STATIC: React.CSSProperties = {
  color: '#181818',
  border: '1px solid #ebecef',
  backgroundColor: 'transparent',
}
const SIDEBAR_BTN_ACTIVE: React.CSSProperties = {
  color: '#ffffff',
  backgroundColor: '#181818',
  border: '1px solid #181818',
}
const LOADING_PILL_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#717680',
  border: '1px solid #ebecef',
}
const LOADING_DOT_STYLE: React.CSSProperties = { backgroundColor: '#00c230' }
const STATUS_VISIBLE_STYLE: React.CSSProperties = {
  backgroundColor: '#ffffff',
  color: '#181818',
  border: '1px solid #ebecef',
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
      style={{ backgroundColor: '#111827' }}
    >
      <span style={{ color: '#9ca3af', fontSize: 14 }}>Loading map…</span>
    </div>
  ),
})

// Track whether we're on a small (mobile) viewport where sm:hidden is inactive.
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

  const { blockedCount, reachableCount } = useMemo(() => {
    let blockedCount = 0
    let reachableCount = 0
    for (const e of events) {
      if (e.blockType !== null) blockedCount++
      if (e.reachable) reachableCount++
    }
    return { blockedCount, reachableCount }
  }, [events])

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    [events]
  )

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden"
      style={{ backgroundColor: '#f3f4f5', color: '#181818' }}
    >
      {/* ─── Top bar ──────────────────────────────────────────── */}
      <header
        className="z-10 flex flex-shrink-0 items-center justify-between gap-4 px-4 py-3"
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #ebecef',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
            style={{ backgroundColor: '#f2280d', color: '#ffffff' }}
            aria-hidden
          >
            R
          </div>
          <div>
            <h1
              className="text-base font-semibold tracking-tight"
              style={{ color: '#181818', margin: 0 }}
            >
              resist.net
            </h1>
            <span
              className="ml-2 hidden text-xs sm:inline"
              style={{ color: '#717680' }}
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
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#181818]/30"
            style={sidebarOpen ? SIDEBAR_BTN_ACTIVE : SIDEBAR_BTN_STATIC}
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
          backgroundColor: '#f9fafb',
          borderBottom: '1px solid #ebecef',
        }}
      >
        <FilterBar active={activeFilter} onChange={setActiveFilter} />
      </div>

      {/* ─── Main content area ────────────────────────────────── */}
      <main className="relative flex min-h-0 flex-1">
        {/* Map — always dark (Leaflet dark tile layer) */}
        <div className="relative flex-1">
          <CensorshipMap events={events} sidebarOpen={sidebarOpen} />

          {/* Error banner — role=alert always in DOM for AT live region registration.
              Inner child uses visibility:hidden when no error to prevent spurious
              empty announcement on mount. */}
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="absolute left-4 right-4 top-4"
            style={{ zIndex: 10, pointerEvents: error ? undefined : 'none' }}
          >
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs"
              style={{
                backgroundColor: '#fee9e7',
                border: '1px solid #f2280d',
                color: '#c2200a',
                animation: error ? 'slideInFromTop 300ms cubic-bezier(0,0,0.2,1)' : undefined,
                visibility: error ? 'visible' : 'hidden',
              }}
            >
              <span aria-hidden>⚠</span>
              {error ? `Failed to load events: ${error}` : ''}
            </div>
          </div>

          {/* Loading overlay on map */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              backgroundColor: loading && events.length === 0 ? 'rgba(17,24,39,0.7)' : 'transparent',
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

          {/* Event count live region */}
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

        {/* Sidebar — events list */}
        <aside
          id="events-panel"
          aria-label="Recent block events"
          {...(!sidebarOpen ? { 'aria-hidden': 'true' as const } : {})}
          className="flex w-80 flex-col flex-shrink-0 overflow-hidden"
          style={{
            display: sidebarOpen ? undefined : 'none',
            backgroundColor: '#ffffff',
            borderLeft: '1px solid #ebecef',
          }}
        >
          <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />
        </aside>
      </main>

      {/* ─── Mobile bottom sheet (small screens) ─────────────── */}
      <div
        role="region"
        className="flex-shrink-0 sm:hidden"
        aria-label="Recent block events (mobile)"
        aria-hidden={isDesktop || sidebarOpen ? 'true' : undefined}
        style={{ borderTop: '1px solid #ebecef' }}
      >
        <div
          className="max-h-56 overflow-y-auto"
          style={{ backgroundColor: '#ffffff' }}
        >
          <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />
        </div>
      </div>
    </div>
  )
}
