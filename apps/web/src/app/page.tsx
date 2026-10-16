'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useSyncExternalStore, useEffect, useRef } from 'react'
import BlockEventList from '../components/BlockEventList'
import FilterBar, { FilterType } from '../components/FilterBar'
import NodeCount from '../components/NodeCount'
import VolunteerCount from '../components/VolunteerCount'
import { useBlockEvents } from '../hooks/useBlockEvents'

// Leaflet must be client-only — no SSR
const CensorshipMap = dynamic(() => import('../components/CensorshipMap'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Loading map"
      className="flex h-full w-full items-center justify-center"
      style={{ backgroundColor: '#0a0a0a' }}
    >
      <div className="flex items-center gap-3 rounded-full px-5 py-2.5 text-sm"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.5)' }}>
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#00c230' }} />
        Loading map…
      </div>
    </div>
  ),
})

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
  const [mounted, setMounted] = useState(false)
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const panelRef = useRef<HTMLElement>(null)
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  const prevSidebarOpenRef = useRef(true)

  useEffect(() => { setMounted(true) }, [])

  // WCAG 2.4.3: move focus into the panel when it opens so keyboard users
  // know where the new content appeared.
  // Skip the initial mount so focus is not hijacked before the user interacts.
  useEffect(() => {
    if (prevSidebarOpenRef.current === sidebarOpen) return
    prevSidebarOpenRef.current = sidebarOpen
    if (sidebarOpen && panelRef.current) {
      panelRef.current.focus()
    } else if (!sidebarOpen && toggleButtonRef.current) {
      toggleButtonRef.current.focus()
    }
  }, [sidebarOpen])

  const { events, loading, error, stats: probeStats } = useBlockEvents({
    blockType: activeFilter === 'all' ? undefined : activeFilter,
    includeStats: true,
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
    // When events is empty, setStableEvents returns the same [] reference on every
    // poll, so this memo only recomputes when there are real changes.
    () => events.length === 0 ? events : [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    [events]
  )

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden"
      style={{ backgroundColor: '#0a0a0a', color: '#ffffff' }}
    >
      <a
        href="#map-region"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to map
      </a>
      {(!isDesktop || sidebarOpen) && (
        <a
          href={isDesktop && sidebarOpen ? '#events-panel' : '#mobile-events-panel'}
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-8 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold focus:text-black"
        >
          Skip to events list
        </a>
      )}
      {/* ─── Top bar ── glass morphism header ── */}
      <header
        className="z-20 flex flex-shrink-0 items-center justify-between gap-4 px-5 py-3"
        style={{
          background: '#111113',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: 'linear-gradient(135deg, #f2280d 0%, #ff6b35 100%)',
              color: '#ffffff',
              boxShadow: '0 2px 12px rgba(242,40,13,0.45)',
            }}
            aria-hidden
          >
            R
          </div>
          <div className="flex items-baseline gap-2">
            <h1
              className="text-sm font-semibold tracking-tight"
              style={{ color: '#ffffff', margin: 0, letterSpacing: '-0.01em' }}
            >
              resist.net
            </h1>
            <span
              className="hidden text-xs sm:inline"
              style={{ color: 'rgba(255,255,255,0.60)' }}
            >
              Community Censorship Monitor
            </span>
          </div>
        </div>

        {/* Stats + sidebar toggle */}
        <div className="flex items-center gap-2.5">
          <VolunteerCount externalVolunteerCount={probeStats?.volunteerCount ?? null} />
          <NodeCount externalStats={probeStats} />
          <button
            ref={toggleButtonRef}
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 min-h-[44px] min-w-[44px]"
            style={sidebarOpen
              ? { background: 'rgba(255,255,255,0.12)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.16)' }
              : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.08)' }
            }
            aria-label={sidebarOpen ? 'Hide events panel' : 'Show events panel'}
            aria-expanded={sidebarOpen}
            aria-controls={sidebarOpen ? 'events-panel' : undefined}
          >
            {sidebarOpen ? 'Hide' : 'Events'}
          </button>
        </div>
      </header>

      {/* ─── Filter bar ── */}
      <div
        role="region"
        aria-label="Event type filter"
        className="z-10 flex-shrink-0 px-5 py-2.5"
        style={{
          background: '#0d0d0f',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <FilterBar active={activeFilter} onChange={setActiveFilter} />
      </div>

      {/* ─── Main content ── */}
      <main id="map-region" className="relative flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative flex-1">
          <CensorshipMap events={events} sidebarOpen={sidebarOpen} />

          {/* Error banner — always in DOM for AT live region */}
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="absolute left-4 right-4 top-4"
            style={{ zIndex: 20, pointerEvents: error ? undefined : 'none' }}
          >
            <div
              className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-medium${error ? ' error-banner-visible' : ''}`}
              style={{
                background: 'rgba(242,40,13,0.15)',
                ...(error ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
                border: '1px solid rgba(242,40,13,0.35)',
                color: '#ff6b55',
                visibility: error ? 'visible' : 'hidden',
              }}
            >
              <span aria-hidden>⚠</span>
              {error
                ? error.includes('HTTP 5')
                  ? 'Failed to load events — server error, please try again in a moment.'
                  : error.includes('HTTP 4')
                    ? 'Failed to load events — request error. Please refresh the page.'
                    : 'Failed to load events. Check your connection and refresh.'
                : ''}
            </div>
          </div>

          {/* Loading overlay */}
          {loading && events.length === 0 && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                backgroundColor: 'rgba(10,10,10,0.75)',
                backdropFilter: 'blur(4px)',
                zIndex: 5,
              }}
              role="status"
              aria-label="Loading probe events"
            >
              <div
                className="flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full live-dot" style={{ backgroundColor: '#00c230' }} />
                Fetching probe events…
              </div>
            </div>
          )}

          {/* Event count badge */}
          <div
            className={!loading && events.length > 0
              ? 'absolute bottom-5 left-5 rounded-full px-4 py-2 text-xs font-semibold'
              : undefined}
            style={!loading && events.length > 0 ? {
              background: 'rgba(255,255,255,0.09)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255,255,255,0.13)',
              color: 'rgba(255,255,255,0.8)',
              zIndex: 5,
              pointerEvents: 'none',
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            } : {
              position: 'absolute',
              width: '1px', height: '1px',
              padding: 0, margin: '-1px',
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {!loading && events.length > 0
              ? <>{blockedCount} blocked<span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.25)' }}> · </span>{reachableCount} reachable</>
              : ''}
          </div>
        </div>

        {/* ─── Sidebar ── glass panel ── */}
        <aside
          id="events-panel"
          ref={panelRef}
          tabIndex={-1}
          aria-label="Recent block events"
          className="flex w-80 flex-shrink-0 flex-col overflow-hidden focus-visible:outline-none"
          style={{
            display: sidebarOpen ? undefined : 'none',
            background: 'rgba(12, 12, 16, 0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {mounted && isDesktop && <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />}
        </aside>
      </main>

      {/* ─── Mobile bottom sheet ── */}
      <div
        id="mobile-events-panel"
        role="region"
        className="flex-shrink-0 sm:hidden"
        aria-label="Block events feed"
        aria-hidden={isDesktop ? true : undefined}
        style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div
          className="max-h-56 overflow-y-auto"
          style={{
            background: 'rgba(12, 12, 16, 0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {mounted && !isDesktop && <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} />}
        </div>
      </div>
    </div>
  )
}
