'use client'

import { useEffect, useState, useRef } from 'react'
import type { ProbeStats } from '../hooks/useBlockEvents'

interface Stats {
  liveProbes: number
  regions: number
  blocksToday: number
}

interface NodeCountProps {
  // When provided by the parent (via useBlockEvents includeStats), NodeCount
  // renders these stats directly and skips its own /api/probe-events polling.
  externalStats?: ProbeStats | null
}

export default function NodeCount({ externalStats }: NodeCountProps = {}) {
  const [stats, setStats] = useState<Stats>({ liveProbes: 0, regions: 0, blocksToday: 0 })
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const announcedRef = useRef(false)
  const prevLiveProbesRef = useRef<number | null>(null)
  const retryRef = useRef<(() => void) | null>(null)

  // When the parent supplies stats from the shared useBlockEvents poll, apply
  // them directly and skip the standalone polling effect below.
  // externalStats=null means the server has no cached stats yet — still mark
  // loading=false so the component doesn't stay stuck in the loading skeleton.
  useEffect(() => {
    if (externalStats === undefined) return
    if (externalStats === null) { setLoading(false); setStale(true); return; }
    setStats(externalStats)
    setLoading(false)
    setStale(false)
    if (externalStats !== null) {
      const probesChanged = prevLiveProbesRef.current !== null && prevLiveProbesRef.current !== externalStats.liveProbes
      if ((!announcedRef.current || probesChanged) && liveRef.current) {
        announcedRef.current = true
        prevLiveProbesRef.current = externalStats.liveProbes
        liveRef.current.textContent =
          `${externalStats.liveProbes.toLocaleString()} live probes across ${externalStats.regions.toLocaleString()} regions, ${externalStats.blocksToday.toLocaleString()} blocks today`
      } else {
        prevLiveProbesRef.current = externalStats.liveProbes
      }
    }
  }, [externalStats])

  useEffect(() => {
    if (stale && liveRef.current) {
      liveRef.current.textContent = 'Network statistics may be outdated — connection issue detected'
    }
  }, [stale])

  useEffect(() => {
    // Skip standalone polling when the parent is supplying stats externally.
    // This eliminates the duplicate /api/probe-events?stats=true request that
    // used to fire every 62s independently of the 30s useBlockEvents interval.
    // externalStats=null still means the parent is supplying (just no cached stats yet).
    if (externalStats !== undefined) return

    let mounted = true
    let consecutiveFailures = 0
    let abortController = new AbortController()
    let seq = 0

    const fetchStats = async () => {
      abortController.abort()
      abortController = new AbortController()
      const { signal } = abortController
      const callSeq = ++seq
      try {
        const res = await fetch('/api/probe-events?stats=true', { signal })
        if (!mounted || callSeq !== seq) return
        if (res.ok) {
          const raw = await res.json()
          if (!mounted || callSeq !== seq) return
          // Guard against unexpected response shapes (e.g. an array from a
          // test mock that intercepts all /api/probe-events routes).
          if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.liveProbes !== 'number') {
            consecutiveFailures++
            if (consecutiveFailures >= 3 && mounted) setStale(true)
            return
          }
          const data: Stats = raw as Stats
          setStats(data)
          setStale(false)
          consecutiveFailures = 0
          const probesChanged = prevLiveProbesRef.current !== null && prevLiveProbesRef.current !== data.liveProbes
          if ((!announcedRef.current || probesChanged) && liveRef.current) {
            announcedRef.current = true
            prevLiveProbesRef.current = data.liveProbes
            liveRef.current.textContent =
              `${data.liveProbes.toLocaleString()} live probes across ${data.regions.toLocaleString()} regions, ${data.blocksToday.toLocaleString()} blocks today`
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
        if (mounted && callSeq === seq) setLoading(false)
      }
    }

    retryRef.current = () => {
      if (!mounted) return
      setRetrying(true)
      consecutiveFailures = 0
      fetchStats().finally(() => { if (mounted) setRetrying(false) })
    }

    fetchStats()
    const interval = setInterval(fetchStats, 62_000)
    return () => {
      mounted = false
      retryRef.current = null
      abortController.abort()
      clearInterval(interval)
    }
  }, [externalStats])

  return (
    <>
      <div ref={liveRef} aria-live="polite" className="sr-only" />

      <div
        role="status"
        className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium"
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.6)',
        }}
        aria-label={loading
          ? 'Loading network statistics'
          : `${stats.liveProbes.toLocaleString()} live probes across ${stats.regions.toLocaleString()} regions, ${stats.blocksToday.toLocaleString()} blocks today${stale ? ' (data may be outdated)' : ''}`}
      >
        {loading ? (
          <span
            aria-hidden="true"
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
              <strong style={{ color: '#ffffff', fontWeight: 600 }}>{stats.liveProbes.toLocaleString()}</strong>
              <span style={{ color: 'rgba(255,255,255,0.60)' }}> probes</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }} aria-hidden>·</span>
            <span aria-hidden>
              <strong style={{ color: '#ffffff', fontWeight: 600 }}>{stats.regions.toLocaleString()}</strong>
              <span style={{ color: 'rgba(255,255,255,0.60)' }}> regions</span>
            </span>
            <span style={{ color: 'rgba(255,255,255,0.15)' }} aria-hidden>·</span>
            <span aria-hidden>
              <strong style={{ color: '#ff6b55', fontWeight: 600 }}>{stats.blocksToday.toLocaleString()}</strong>
              <span style={{ color: 'rgba(255,255,255,0.60)' }}> blocks</span>
            </span>
            {stale && (
              <button
                onClick={() => retryRef.current?.()}
                disabled={retrying}
                title="Stats unavailable — check connection"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  background: 'none',
                  border: 'none',
                  padding: '0 2px',
                  cursor: retrying ? 'default' : 'pointer',
                  color: 'var(--wld-warning-500, #ffb833)',
                  fontSize: 10,
                  fontStyle: 'italic',
                  opacity: retrying ? 0.6 : 1,
                }}
                aria-label="Stats unavailable — check connection. Click to retry."
              >
                <span aria-hidden>⚠</span>
                {retrying ? 'retrying…' : 'Offline — retry?'}
              </button>
            )}
          </>
        )}
      </div>
    </>
  )
}
