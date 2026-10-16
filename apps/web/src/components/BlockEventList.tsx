'use client'

import { useMemo, memo, useEffect, useRef, useState } from 'react'
import StatusChip, { BlockType } from './StatusChip'

const URL_CACHE_MAX = 1000

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
}

interface BlockEventListProps {
  events: ProbeResultRow[]
  loading: boolean
  /** Pre-sorted, pre-sliced events from the parent. When provided, the internal
   *  sort+slice is skipped — avoids duplicating O(N log N) work when this component
   *  is mounted twice (sidebar + mobile sheet). */
  sortedEvents?: ProbeResultRow[]
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 10) return wallet
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
}

export default memo(function BlockEventList({ events, loading, sortedEvents }: BlockEventListProps) {
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
  useEffect(() => {
    if (!liveRef.current) return
    if (loading) return
    const count = sorted.length
    if (count !== prevCountRef.current) {
      prevCountRef.current = count
      liveRef.current.textContent = count > 0 ? `${count} events loaded` : 'No events yet'
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
        style={{ borderBottom: '1px solid #ebecef' }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: '#717680', margin: 0 }}
        >
          Recent Events
        </h2>
        <div
          className="rounded-full border px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: '#f3f4f5', borderColor: '#ebecef', color: '#717680' }}
          aria-hidden="true"
        >
          {sorted.length}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && sorted.length === 0 ? (
          <div role="status" aria-label="Loading events" aria-busy="true" className="space-y-2 p-4">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-xl"
                style={{ backgroundColor: '#f3f4f5' }}
              />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div
            className="flex h-32 items-center justify-center text-sm"
            style={{ color: '#717680' }}
          >
            No events yet
          </div>
        ) : (
          <ul aria-label="Recent censorship events, sorted newest first" className="px-4 py-2">
            {sorted.map((event) => (
              <li key={event.id} className="py-3" style={{ borderBottom: '1px solid #ebecef' }}>
                <div className="flex items-start justify-between gap-3">
                  {/* Left: chip + url */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <StatusChip blockType={event.blockType} />
                    </div>
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: '#181818' }}
                      title={event.targetUrl}
                    >
                      <span aria-hidden="true">{cachedTruncateUrl(event.targetUrl)}</span>
                      <span className="sr-only">{event.targetUrl}</span>
                    </p>
                    <p
                      className="mt-0.5 text-xs"
                      style={{ color: '#717680' }}
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
                    className="flex-shrink-0 pt-0.5 text-xs"
                    style={{ color: '#717680' }}
                  >
                    {timeAgo(event.timestamp)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
})
