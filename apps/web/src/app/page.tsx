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
      style={{ backgroundColor: 'var(--wld-surface-dark)' }}
    >
      <div className="flex items-center gap-3 rounded-full px-5 py-2.5 text-sm"
        style={{ background: 'var(--wld-glass-border-strong)', border: '1px solid var(--wld-glass-bg)', color: 'var(--wld-glass-text-dim)' }}>
        <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--wld-green-primary)' }} />
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
  // Intentionally ephemeral: sidebar state is not persisted across reloads.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSheetOpen, setMobileSheetOpen] = useState(true)
  const [mounted, setMounted] = useState(false)
  const isDesktop = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const panelRef = useRef<HTMLElement>(null)
  const toggleButtonRef = useRef<HTMLButtonElement>(null)
  const mobileSheetRef = useRef<HTMLDivElement>(null)
  const mobileToggleRef = useRef<HTMLButtonElement>(null)
  const prevSidebarOpenRef = useRef(true)
  const prevMobileSheetOpenRef = useRef(true)

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

  // WCAG 2.4.3: move focus to the map region when the mobile sheet is closed.
  // Skip the initial mount so focus is not hijacked on page load.
  useEffect(() => {
    if (prevMobileSheetOpenRef.current === mobileSheetOpen) return
    prevMobileSheetOpenRef.current = mobileSheetOpen
    if (mobileSheetOpen && mobileSheetRef.current) {
      mobileSheetRef.current.focus()
    } else if (!mobileSheetOpen && mobileToggleRef.current) {
      mobileToggleRef.current.focus()
    }
  }, [mobileSheetOpen])

  const { events, stats, loading, error } = useBlockEvents({
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
    // When events is empty, setStableEvents returns the same [] reference on every
    // poll, so this memo only recomputes when there are real changes.
    () => events.length === 0 ? events : [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    [events]
  )

  return (
    <div
      className="flex h-screen w-full flex-col overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, rgba(30,20,50,0.9) 0%, var(--wld-surface-dark-deep) 55%, var(--wld-surface-dark-deeper) 100%)', color: 'var(--wld-gray-0)' }}
    >
      <a
        href="#map-region"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold"
        style={{ backgroundColor: 'var(--wld-surface-dark-skip)', color: 'var(--wld-glass-text-near-white)', backdropFilter: 'blur(12px)', border: '1px solid var(--wld-glass-highlight)' }}
      >
        Skip to map
      </a>
      {(!isDesktop || sidebarOpen) && (
        <a
          href={isDesktop && sidebarOpen ? '#events-panel' : '#mobile-events-panel'}
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-8 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-sm focus:font-semibold"
          style={{ backgroundColor: 'var(--wld-surface-dark-skip)', color: 'var(--wld-glass-text-near-white)', backdropFilter: 'blur(12px)', border: '1px solid var(--wld-glass-highlight)' }}
        >
          Skip to events list
        </a>
      )}
      {/* ─── Top bar ── glass morphism header ── */}
      <header
        className="z-20 flex flex-shrink-0 items-center justify-between gap-4 px-5 py-3"
        style={{
          background: 'var(--wld-surface-dark-header)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--wld-glass-border-strong)',
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: 'linear-gradient(135deg, #f2280d 0%, #ff6b35 100%)',
              color: 'var(--wld-gray-0)',
              boxShadow: '0 2px 12px var(--wld-error-glow)',
            }}
            aria-hidden
          >
            R
          </div>
          <div className="flex items-baseline gap-2">
            <h1
              className="text-sm font-semibold tracking-tight"
              style={{ color: 'var(--wld-gray-0)', margin: 0, letterSpacing: '-0.01em' }}
            >
              resist.net
            </h1>
            <span
              className="hidden text-xs sm:inline"
              style={{ color: 'var(--wld-glass-text-secondary)' }}
            >
              Community Censorship Monitor
            </span>
          </div>
        </div>

        {/* Stats + sidebar toggle */}
        <div className="flex items-center gap-2.5">
          <VolunteerCount externalVolunteerCount={stats?.volunteerCount ?? null} />
          <NodeCount externalStats={stats} />
          <a
            href="/contribute"
            className="hidden rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:inline-flex items-center"
            style={{ background: 'transparent', color: 'var(--wld-glass-text-body)', border: '1px solid var(--wld-glass-divider)' }}
          >
            Run a probe
          </a>
          <button
            ref={toggleButtonRef}
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 min-h-[44px] min-w-[44px]"
            style={sidebarOpen
              ? { background: 'var(--wld-glass-bg-active)', color: 'var(--wld-gray-0)', border: '1px solid var(--wld-glass-border-mid)' }
              : { background: 'var(--wld-glass-bg-faint)', color: 'var(--wld-glass-text-muted)', border: '1px solid var(--wld-glass-bg-muted)' }
            }
            aria-label={sidebarOpen ? 'Hide events panel' : 'Show events panel'}
            aria-expanded={sidebarOpen}
            aria-controls="events-panel"
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
          background: 'var(--wld-surface-dark-filter)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--wld-glass-border-strong)',
          boxShadow: 'inset 0 1px 0 var(--wld-glass-border-faint)',
        }}
      >
        <FilterBar active={activeFilter} onChange={setActiveFilter} />
      </div>

      {/* ─── Main content ── */}
      <main id="map-region" className="relative flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative flex-1" style={{ boxShadow: 'inset 0 0 0 1px var(--wld-glass-border)', borderTop: '1px solid var(--wld-glass-border-faint)' }}>
          <CensorshipMap events={events} sidebarOpen={sidebarOpen} />

          {/* Error banner — always in DOM for AT live region */}
          <div
            aria-live="assertive"
            aria-atomic="true"
            className="absolute left-4 right-4 top-4"
            style={{ zIndex: 20, pointerEvents: error ? undefined : 'none' }}
          >
            <div
              role={error ? 'alert' : undefined}
              className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-medium${error ? ' error-banner-visible' : ''}`}
              style={{
                background: 'var(--wld-error-bg-tint)',
                ...(error ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
                border: '1px solid var(--wld-error-border-tint)',
                color: 'var(--wld-error-text)',
                opacity: error ? 1 : 0,
                transition: 'opacity 0.2s ease',
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
                backgroundColor: 'var(--wld-surface-dark-overlay)',
                backdropFilter: 'blur(4px)',
                zIndex: 5,
              }}
              role="status"
              aria-label="Loading probe events"
            >
              <div
                className="flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm"
                style={{
                  background: 'var(--wld-glass-bg-muted)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid var(--wld-glass-bg-active)',
                  color: 'var(--wld-glass-text-secondary-alt)',
                }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full live-dot" style={{ backgroundColor: 'var(--wld-green-primary)' }} />
                Loading probe events…
              </div>
            </div>
          )}

          {/* Event count badge */}
          <div
            data-testid="event-count-badge"
            className={!loading && events.length > 0
              ? 'absolute bottom-5 left-5 rounded-full px-4 py-2 text-xs font-semibold'
              : undefined}
            style={!loading && events.length > 0 ? {
              background: 'var(--wld-glass-bg-soft)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid var(--wld-glass-bg-accent)',
              color: 'var(--wld-glass-text-strong)',
              zIndex: 5,
              pointerEvents: 'none',
              boxShadow: '0 4px 20px var(--wld-dark-overlay-mid)',
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
              ? <>{blockedCount} blocked<span aria-hidden="true" style={{ color: 'var(--wld-glass-text-faint)' }}> · </span>{reachableCount} reachable</>
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
            background: 'var(--wld-surface-dark-glass)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderLeft: '1px solid var(--wld-glass-border-strong)',
          }}
        >
          {mounted && isDesktop && <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} isFiltered={activeFilter !== 'all'} />}
        </aside>
      </main>

      {/* ─── Mobile bottom sheet ── */}
      <div
        className="flex-shrink-0 sm:hidden"
        style={{ borderTop: '1px solid var(--wld-glass-border-strong)' }}
      >
        {/* Toggle button — always visible on mobile so keyboard/pointer users can open/close */}
        <button
          ref={mobileToggleRef}
          onClick={() => setMobileSheetOpen((v) => !v)}
          aria-expanded={mobileSheetOpen}
          aria-controls="mobile-events-panel"
          className="flex w-full items-center justify-between px-4 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 min-h-[44px] hover:bg-white/5 transition-colors duration-100"
          style={{ background: 'var(--wld-surface-dark-glass-solid)', color: 'var(--wld-glass-text-secondary-alt)' }}
        >
          <span>Block events feed</span>
          <span aria-hidden="true">{mobileSheetOpen ? '▾' : '▴'}</span>
        </button>
        {mobileSheetOpen && (
          <div
            id="mobile-events-panel"
            ref={mobileSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Block events feed"
            tabIndex={-1}
            className="max-h-56 overflow-y-auto focus-visible:outline-none dark-scrollbar"
            style={{
              background: 'var(--wld-surface-dark-glass-solid)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <div className="h-1 w-10 rounded-full" style={{ background: 'var(--wld-glass-highlight)' }} />
              <button
                onClick={() => setMobileSheetOpen(false)}
                className="rounded p-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 min-h-[44px] min-w-[44px] flex items-center justify-center"
                style={{ color: 'var(--wld-glass-text-muted)' }}
                aria-label="Close events feed"
              >
                ✕
              </button>
            </div>
            {mounted && !isDesktop && <BlockEventList events={events} loading={loading} sortedEvents={sortedEvents} isFiltered={activeFilter !== 'all'} />}
          </div>
        )}
      </div>
    </div>
  )
}
