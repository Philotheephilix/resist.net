import { useState, useEffect, useRef, useCallback } from 'react'
import type { ProbeResultRow } from '../components/BlockEventList'

interface BlockEventFilters {
  blockType?: string
  includeStats?: boolean
  geohash?: string
}

export interface ProbeStats {
  liveProbes: number
  regions: number
  blocksToday: number
  volunteerCount?: number
}

export function useBlockEvents(filters: BlockEventFilters) {
  const [events, setEvents] = useState<ProbeResultRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // stats are only populated when filters.includeStats=true; null until first
  // successful fetch or when the server has no cached stats yet.
  const [stats, setStats] = useState<ProbeStats | null>(null)
  const seqRef = useRef(0)
  // Stable prev-events ref — only swap the array when content changes, so consumers
  // that useMemo-depend on `events` don't recompute on polls that return the same data.
  const prevEventsRef = useRef<ProbeResultRow[]>([])
  const setStableEvents = useCallback((next: ProbeResultRow[]) => {
    const prev = prevEventsRef.current
    if (next.length === 0 && prev.length === 0) return
    if (next.length === prev.length && next.length > 0) {
      const prevIds = new Set<string>()
      for (const e of prev) prevIds.add(e.id)
      if (next.every(e => prevIds.has(e.id))) return
    }
    prevEventsRef.current = next
    setEvents(next)
  }, [])

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
        if (filters.includeStats) params.set('includeStats', 'true')

        const res = await window.fetch(`/api/probe-events?${params}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        let eventsArray: ProbeResultRow[]
        if (filters.includeStats) {
          // Response shape: { events: ProbeResultRow[], stats: ProbeStats | null }
          if (!data || !Array.isArray(data.events)) throw new Error('Unexpected response shape')
          eventsArray = data.events
          // Update stats regardless of whether data.stats is truthy — null is valid
          // (server has no cached stats yet) and must clear stale stats from a prior
          // filter change rather than silently leaving the previous value.
          if (!cancelled && seq === seqRef.current) {
            setStats(data.stats != null ? data.stats : null)
          }
        } else {
          if (!Array.isArray(data)) throw new Error('Unexpected response shape')
          eventsArray = data
        }

        if (!cancelled && seq === seqRef.current) {
          setStableEvents(eventsArray)
          setError(null)
        }
      } catch (err) {
        // Ignore aborted fetches — they are expected on filter change / unmount.
        // Guard both DOMException (spec) and plain Error with name=AbortError
        // (older Safari, node-fetch v2) to avoid spurious error banners on abort.
        if (err instanceof Error && err.name === 'AbortError') return
        if (!cancelled && seq === seqRef.current) {
          // Clear stale events so the UI does not show outdated data alongside the error.
          setStableEvents([])
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

    let intervalId: ReturnType<typeof setInterval> | undefined

    const startInterval = () => {
      intervalId = setInterval(() => { fetchEvents() }, 30_000)
    }

    const stopInterval = () => {
      clearInterval(intervalId)
      intervalId = undefined
    }

    if (document.visibilityState !== 'hidden') {
      startInterval()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopInterval()
      } else {
        stopInterval()
        setLoading(true)
        fetchEvents().finally(() => { if (!cancelled) startInterval() })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      abortController.abort()
      stopInterval()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [filters.blockType, filters.geohash, filters.includeStats, setStableEvents])

  return { events, loading, error, stats }
}
