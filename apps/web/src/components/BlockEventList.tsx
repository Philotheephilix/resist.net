'use client'

import { useMemo, memo, useEffect, useRef, useState } from 'react'
import StatusChip, { BlockType } from './StatusChip'

const URL_CACHE_MAX = 1000
const SKELETON_ITEMS = [0, 1, 2, 3, 4]

// Module-level 60s tick shared across all mounted BlockEventList instances.
// Without this, each instance creates its own setInterval, causing redundant
// re-renders when the same data is displayed in both sidebar and mobile sheet.
type TickListener = () => void
const tickListeners = new Set<TickListener>()
let tickIntervalId: ReturnType<typeof setInterval> | null = null
function subscribeToTick(fn: TickListener): () => void {
  tickListeners.add(fn)
  if (tickIntervalId === null) {
    tickIntervalId = setInterval(() => {
      tickListeners.forEach(cb => cb())
    }, 60_000)
  }
  return () => {
    tickListeners.delete(fn)
    if (tickListeners.size === 0 && tickIntervalId !== null) {
      clearInterval(tickIntervalId)
      tickIntervalId = null
    }
  }
}

// Module-level URL hostname cache with size cap to prevent unbounded memory growth
// in long-running sessions with many unique probe URLs.
const urlHostnameCache = new Map<string, string>()
function cachedTruncateUrl(url: string): string {
  let result = urlHostnameCache.get(url)
  if (result !== undefined) {
    // LRU promotion: move to end so keys().next() evicts the least-recently-used entry
    urlHostnameCache.delete(url)
    urlHostnameCache.set(url, result)
    return result
  }
  try {
    result = new URL(url).hostname
  } catch {
    result = url.length > 32 ? url.slice(0, 32) + '…' : url
  }
  if (urlHostnameCache.size >= URL_CACHE_MAX) {
    urlHostnameCache.delete(urlHostnameCache.keys().next().value!)
  }
  urlHostnameCache.set(url, result)
  return result
}

// Module-level timestamp format cache — event.timestamp is immutable so formatted
// strings never go stale; caching avoids two Date allocations per event per render.
const tsIsoCache = new Map<number, string>()
const tsLocaleCache = new Map<number, string>()
function cachedTsIso(ts: number): string {
  let s = tsIsoCache.get(ts)
  if (s !== undefined) { tsIsoCache.delete(ts); tsIsoCache.set(ts, s); return s }
  s = new Date(ts).toISOString()
  if (tsIsoCache.size >= URL_CACHE_MAX) tsIsoCache.delete(tsIsoCache.keys().next().value!)
  tsIsoCache.set(ts, s)
  return s
}
function cachedTsLocale(ts: number): string {
  let s = tsLocaleCache.get(ts)
  if (s !== undefined) { tsLocaleCache.delete(ts); tsLocaleCache.set(ts, s); return s }
  s = new Date(ts).toLocaleString()
  if (tsLocaleCache.size >= URL_CACHE_MAX) tsLocaleCache.delete(tsLocaleCache.keys().next().value!)
  tsLocaleCache.set(ts, s)
  return s
}

export interface ProbeResultRow {
  id: string
  targetUrl: string
  blockType: BlockType
  geohash: string
  timestamp: number
  nodeWallet: string
  reachable: boolean
  verified?: boolean
}

interface BlockEventListProps {
  events: ProbeResultRow[]
  loading: boolean
  /** Pre-sorted, pre-sliced events from the parent. When provided, the internal
   *  sort+slice is skipped — avoids duplicating O(N log N) work when this component
   *  is mounted twice (sidebar + mobile sheet). */
  sortedEvents?: ProbeResultRow[]
  isFiltered?: boolean
}

const timeAgoCache = new Map<number, { bucket: number; value: string }>()
function timeAgo(ts: number, now: number): string {
  const bucket = Math.floor(now / 60_000)
  const cached = timeAgoCache.get(ts)
  if (cached !== undefined && cached.bucket === bucket) return cached.value
  const diffMs = now - ts
  const mins = Math.floor(diffMs / 60_000)
  let s: string
  if (mins < 1) s = 'just now'
  else if (mins < 60) s = `${mins} min ago`
  else { const hrs = Math.floor(mins / 60); if (hrs < 24) { s = `${hrs} hr ago` } else { const days = Math.floor(hrs / 24); s = days === 1 ? '1 day ago' : days < 8 ? `${days} days ago` : new Date(ts).toLocaleDateString() } }
  if (timeAgoCache.size >= URL_CACHE_MAX && !timeAgoCache.has(ts)) timeAgoCache.delete(timeAgoCache.keys().next().value!)
  timeAgoCache.set(ts, { bucket, value: s })
  return s
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  dns_poisoning: 'DNS Poisoning',
  tcp_rst: 'TCP Reset',
  http_block: 'HTTP Block',
  full_unreachable: 'Unreachable',
}
function blockTypeLabel(blockType: BlockType): string {
  return blockType ? (BLOCK_TYPE_LABELS[blockType] ?? blockType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : 'Reachable'
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

export default memo(function BlockEventList({ events, loading, sortedEvents, isFiltered }: BlockEventListProps) {
  // Tick every 60s to refresh timeAgo labels between data-fetch polls.
  // Uses a shared module-level interval so two mounted instances (sidebar +
  // mobile sheet) do not each create their own redundant timer.
  const [, setTick] = useState(0)
  // Stable ref so the same function identity is passed to subscribeToTick on every
  // invocation (Strict Mode double-invoke, remount). Without this, cleanup removes
  // the first inline arrow and subscribe adds a second one — between cleanup and
  // re-subscribe tickListeners hits size 0 and the interval is torn down, causing
  // a brief window where 60s tick labels can go stale for an extra full interval.
  const tickListenerRef = useRef(() => setTick(t => t + 1))
  useEffect(() => subscribeToTick(tickListenerRef.current), [])

  // Only compute ownSorted when sortedEvents is not provided (standalone usage).
  // When sortedEvents is provided the result is always []; including events in the
  // static dep array is safe because React compares individual elements via Object.is —
  // it never creates a new array from the dep list itself. A static dep array is also
  // statically analyzable by react-hooks/exhaustive-deps.
  const ownSorted = useMemo(
    () => sortedEvents ? [] : [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50),
    [sortedEvents, events] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const sorted = sortedEvents ?? ownSorted

  // Single coordinated live region — announce the event count ONLY after loading
  // completes (not on every poll tick while loading is still true). This prevents
  // two simultaneous AT announcements (loading skeleton + count badge) during the
  // loading→loaded transition. aria-live=polite; content is a full sentence with
  // context so AT users hear "42 events loaded" not just "42".
  const liveRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef<number | null>(null)
  const didMountRef = useRef(false)
  useEffect(() => { didMountRef.current = true }, [])
  useEffect(() => {
    if (!liveRef.current) return
    if (loading) return
    if (!didMountRef.current) return
    const count = sorted.length
    if (count !== prevCountRef.current) {
      prevCountRef.current = count
      liveRef.current.textContent = count > 0 ? `${count} events loaded` : isFiltered ? 'No events match this filter' : 'No events yet'
    }
  }, [loading, sorted.length])

  return (
    <div className="flex h-full flex-col">
      {/* Off-screen live region — announces event count after load completes.
          Always in DOM so AT registers the aria-live before any data arrives. */}
      <div ref={liveRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: '1px solid var(--wld-glass-border)' }}
      >
        <h2
          id="events-list-heading"
          className="text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--wld-glass-text-tertiary)', margin: 0 }}
        >
          Recent Events
          <span className="sr-only">{sorted.length} events</span>
        </h2>
        <div
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: 'var(--wld-glass-border-strong)', color: 'var(--wld-glass-text-muted)' }}
          aria-hidden="true"
        >
          {sorted.length}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto dark-scrollbar">
        {loading && sorted.length === 0 ? (
          <div role="status" aria-label="Loading events" aria-busy="true" className="space-y-2 p-4">
            {SKELETON_ITEMS.map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-2xl skeleton-shimmer"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div
            className="flex h-32 items-center justify-center text-sm"
            style={{ color: 'var(--wld-glass-text-faint)' }}
          >
            {isFiltered ? 'No events match this filter' : 'No events yet'}
          </div>
        ) : (
          <ul aria-labelledby="events-list-heading" className="px-3 py-2">
            {(() => { const renderNow = Date.now(); return sorted.map((event, i) => (
              <li
                key={event.id}
                className="event-item rounded-2xl px-3 py-3 transition-[background-color] duration-100 hover:bg-white/5"
                style={{
                  ['--animation-delay' as string]: `${Math.min(i * 30, 300)}ms`,
                  borderBottom: i < sorted.length - 1 ? '1px solid var(--wld-glass-border-subtle)' : 'none',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: chip + url */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <StatusChip blockType={event.blockType} />
                      {event.blockType !== null && event.verified === false && (
                        <span
                          className="rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ background: 'var(--wld-warning-bg-tint)', color: 'var(--wld-warning-text-dim)' }}
                          title="Reported by a single node — not yet corroborated by 3+ independent regions"
                          aria-label="unverified — single node report"
                        >
                          unverified
                        </span>
                      )}
                    </div>
                    <p
                      className="truncate text-[13px] font-medium leading-snug"
                      style={{ color: 'var(--wld-glass-text-primary)' }}
                      title={event.targetUrl}
                    >
                      <a
                        href={event.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline focus:outline-none focus:underline"
                        style={{ color: 'inherit' }}
                      >
                        <span aria-hidden="true">{cachedTruncateUrl(event.targetUrl)}</span>
                        <span className="sr-only">{event.targetUrl} — {blockTypeLabel(event.blockType)} (opens in new tab)</span>
                      </a>
                    </p>
                    <p
                      className="mt-0.5 font-mono text-[11px]"
                      style={{ color: 'var(--wld-glass-text-muted)' }}
                      title={event.nodeWallet}
                    >
                      <span aria-hidden="true">{truncateWallet(event.nodeWallet)}</span>
                      <span className="sr-only">Node: {event.nodeWallet}</span>
                    </p>
                  </div>

                  {/* Right: time */}
                  <time
                    dateTime={cachedTsIso(event.timestamp)}
                    title={cachedTsLocale(event.timestamp)}
                    aria-label={cachedTsLocale(event.timestamp)}
                    className="flex-shrink-0 pt-0.5 text-[11px]"
                    style={{ color: 'var(--wld-glass-text-muted)' }}
                  >
                    {timeAgo(event.timestamp, renderNow)}
                  </time>
                </div>
              </li>
            ))})()}
          </ul>
        )}
      </div>
    </div>
  )
})
