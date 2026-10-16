import { useState, useEffect, useRef, useCallback } from 'react'
import type { ProbeResultRow } from '../components/BlockEventList'

interface BlockEventFilters {
  blockType?: string
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
  const seqRef = useRef(0)
  // Stable prev-events ref — only swap the array when content changes, so consumers
  // that useMemo-depend on `events` don't recompute on polls that return the same data.
  const prevEventsRef = useRef<ProbeResultRow[]>([])
  const setStableEvents = useCallback((next: ProbeResultRow[]) => {
    const prev = prevEventsRef.current
    if (next.length === 0 && prev.length === 0) return
    if (next.length === prev.length && next.length > 0) {
      const prevMap = new Map<string, ProbeResultRow>()
      for (const e of prev) prevMap.set(e.id, e)
      if (next.every(e => {
        const p = prevMap.get(e.id)
        return p !== undefined && p.blockType === e.blockType
      })) return
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

        const res = await window.fetch(`/api/probe-events?${params}`, { signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        if (!Array.isArray(data)) throw new Error('Unexpected response shape')

        if (!cancelled && seq === seqRef.current) {
          setStableEvents(data)
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
    let visibilityFetchSeq = 0

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
        const myVisSeq = ++visibilityFetchSeq
        setLoading(true)
        fetchEvents().finally(() => {
          if (!cancelled && myVisSeq === visibilityFetchSeq) startInterval()
        })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      abortController.abort()
      stopInterval()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [filters.blockType, setStableEvents])

  return { events, loading, error }
}
