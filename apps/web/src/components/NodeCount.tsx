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
  // Off-screen live region — announced on initial load and when liveProbes changes
  // by ≥1 (a meaningful network change). Subsequent silent polls that return the same
  // numbers produce no AT interruption. Decoupled from the visible widget.
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
          // Announce on initial load AND when liveProbes changes (meaningful network event).
          // Silent polls that return the same numbers produce no AT interruption.
          // aria-label mutation alone does not trigger re-announcement in most AT;
          // updating textContent on the live region is the reliable mechanism.
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
    // 62s offset avoids polling in lockstep with BlockEventList's 60s tick,
    // spreading API requests across the minute instead of batching them at :00.
    const interval = setInterval(fetchStats, 62_000)
    return () => {
      mounted = false
      abortController.abort()
      clearInterval(interval)
    }
  }, [])

  const sep = (
    <span style={{ color: 'var(--wld-gray-500)' }} aria-hidden>
      •
    </span>
  )

  return (
    <>
      {/* Always-mounted off-screen live region — AT must see it at first render so
          the polite region is registered before any announcement fires. Putting it
          inside the loading branch would cause AT to miss the initial announcement
          because the region was not yet in the DOM when the announcement fired. */}
      <div ref={liveRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Single persistent role=status div — always in DOM so AT tracks the same
          element identity across the loading→loaded transition. Swapping two
          separate divs (loading vs loaded) causes AT to lose the element and may
          suppress re-announcement. We update aria-label and content in place. */}
      <div
        role="status"
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs${loading ? '' : ' font-medium'}`}
        style={{
          backgroundColor: 'var(--wld-glass-bg-faint)',
          color: loading ? 'var(--wld-gray-400)' : 'var(--wld-gray-300)',
        }}
        aria-label={loading
          ? 'Loading network statistics'
          : `${stats.liveProbes} live probes across ${stats.regions} regions, ${stats.blocksToday} blocks today${stale ? ' (data may be outdated)' : ''}`}
      >
        {loading ? (
          <span
            className="inline-block h-1.5 w-16 rounded-full"
            style={{ backgroundColor: 'var(--wld-glass-bg)' }}
          />
        ) : (
          <>
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: 'var(--wld-success-600)' }}
              aria-hidden
            />
            <span aria-hidden>
              <strong style={{ color: 'var(--wld-gray-0)', fontWeight: 600 }}>{stats.liveProbes}</strong>{' '}
              live probes
            </span>
            {sep}
            <span aria-hidden>
              <strong style={{ color: 'var(--wld-gray-0)', fontWeight: 600 }}>{stats.regions}</strong>{' '}
              regions
            </span>
            {sep}
            <span aria-hidden>
              <strong style={{ color: 'var(--wld-error-400)', fontWeight: 600 }}>
                {stats.blocksToday}
              </strong>{' '}
              blocks today
            </span>
            {stale && (
              <span
                aria-hidden
                style={{ color: 'var(--wld-warning-600)', fontSize: 10, fontStyle: 'italic' }}
              >
                (stale)
              </span>
            )}
          </>
        )}
      </div>
    </>
  )
}
