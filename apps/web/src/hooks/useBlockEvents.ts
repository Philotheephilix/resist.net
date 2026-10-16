import { useState, useEffect, useRef } from 'react'
import type { ProbeResultRow } from '../components/BlockEventList'

interface BlockEventFilters {
  blockType?: string
  geohash?: string
}

export function useBlockEvents(filters: BlockEventFilters) {
  const [events, setEvents] = useState<ProbeResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let abortController = new AbortController()

    // Hold previous events (stale-while-revalidate) until the new fetch lands —
    // clearing them immediately causes a blank-screen flash during filter changes.
    // Only reset to empty if this is truly a fresh mount (events was already []).
    setError(null)
    setLoading(true)

    const fetchEvents = async () => {
      const seq = ++seqRef.current
      // Abort any in-flight request from a previous call — prevents stale requests
      // from piling up when filters change rapidly or the component unmounts.
      abortController.abort()
      abortController = new AbortController()
      const signal = abortController.signal

      try {
        const params = new URLSearchParams()
        if (filters.blockType) params.set('blockType', filters.blockType)
        if (filters.geohash) params.set('geohash', filters.geohash)

        const res = await window.fetch(`/api/probe-events?${params}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled && seq === seqRef.current) {
          setEvents(data)
          setError(null)
        }
      } catch (err) {
        // Ignore aborted fetches — they are expected on filter change / unmount.
        // Guard both DOMException (spec) and plain Error with name=AbortError
        // (older Safari, node-fetch v2) to avoid spurious error banners on abort.
        if (err instanceof Error && err.name === 'AbortError') return
        if (!cancelled && seq === seqRef.current) {
          // Clear stale events so the UI does not show outdated data alongside the error.
          setEvents([])
          setError(err instanceof Error ? err.message : 'Failed to fetch events')
        }
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false)
      }
    }

    // Guard the initial fetch — skip when the tab is already hidden at effect-run time.
    if (document.visibilityState !== 'hidden') {
      fetchEvents()
    } else {
      setLoading(false)
    }

    // Skip polling when the tab is hidden — saves network + CPU with no user benefit.
    // Resume immediately when the tab becomes visible again. Reset the interval on
    // tab-show so the next scheduled tick fires 30s after the immediate fetch, not
    // independently (prevents double-fetch within the same 30s window).
    let intervalId = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchEvents()
    }, 30_000)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Set loading so the UI shows skeleton instead of "No events yet" during refresh
      setLoading(true)
      // Clear the existing interval BEFORE fetching. Start the new interval inside
      // fetchEvents's finally block (via the chained resetInterval) so it fires 30s
      // after the fetch completes — not 30s from now — preventing a double-fetch
      // within the same window if the fetch is slow.
      clearInterval(intervalId)
      const resetInterval = () => {
        clearInterval(intervalId)
        intervalId = setInterval(() => {
          if (document.visibilityState === 'hidden') return
          fetchEvents()
        }, 30_000)
      }
      fetchEvents().then(resetInterval, resetInterval)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      abortController.abort()
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [filters.blockType, filters.geohash])

  return { events, loading, error }
}
