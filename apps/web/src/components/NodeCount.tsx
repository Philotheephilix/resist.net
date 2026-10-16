'use client'

import { useEffect, useState, useRef } from 'react'

interface Stats {
  liveProbes: number
  regions: number
  blocksToday: number
}

export default function NodeCount() {
  const [stats, setStats] = useState<Stats>({ liveProbes: 0, regions: 0, blocksToday: 0 })
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const announcedRef = useRef(false)
  const prevLiveProbesRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    let consecutiveFailures = 0
    let abortController = new AbortController()

    const fetchStats = async () => {
      abortController.abort()
      abortController = new AbortController()
      const { signal } = abortController
      try {
        const res = await fetch('/api/probe-events?stats=true', { signal })
        if (!mounted) return
        if (res.ok) {
          const data = await res.json()
          if (!mounted) return
          setStats(data)
          setStale(false)
          consecutiveFailures = 0
          const probesChanged = prevLiveProbesRef.current !== null && prevLiveProbesRef.current !== data.liveProbes
          if ((!announcedRef.current || probesChanged) && liveRef.current) {
            announcedRef.current = true
            prevLiveProbesRef.current = data.liveProbes
            liveRef.current.textContent =
              `${data.liveProbes} live probes across ${data.regions} regions, ${data.blocksToday} blocks today`
          } else {
            prevLiveProbesRef.current = data.liveProbes
          }
        } else {
          consecutiveFailures++
          if (consecutiveFailures >= 3 && mounted) setStale(true)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        consecutiveFailures++
        if (consecutiveFailures >= 3 && mounted) setStale(true)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 62_000)
    return () => {
      mounted = false
      abortController.abort()
      clearInterval(interval)
    }
  }, [])

  return (
    <>
      <div ref={liveRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      <div
        className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs${loading ? '' : ' font-medium'}`}
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.6)',
        }}
        aria-label={loading
          ? 'Loading network statistics'
          : `${stats.liveProbes} live probes across ${stats.regions} regions, ${stats.blocksToday} blocks today${stale ? ' (data may be outdated)' : ''}`}
      >
        {loading ? (
          <span
            className="inline-block h-1.5 w-20 rounded-full skeleton-shimmer"
          />
        ) : (
          <>
            <span
              className="live-dot inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: '#00c230' }}
              aria-hidden
            />
            <span aria-hidden>
              <strong style={{ color: '#ffffff', fontWeight: 600 }}>{stats.liveProbes}</strong>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> probes</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }} aria-hidden>·</span>
            <span aria-hidden>
              <strong style={{ color: '#ffffff', fontWeight: 600 }}>{stats.regions}</strong>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> regions</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }} aria-hidden>·</span>
            <span aria-hidden>
              <strong style={{ color: '#ff6b55', fontWeight: 600 }}>{stats.blocksToday}</strong>
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> blocks</span>
            </span>
            {stale && (
              <span aria-hidden style={{ color: '#ffb733', fontSize: 10, fontStyle: 'italic' }}>
                (stale)
              </span>
            )}
          </>
        )}
      </div>
    </>
  )
}
