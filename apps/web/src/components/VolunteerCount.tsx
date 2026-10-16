'use client'

import { useEffect, useRef, useState } from 'react'

interface VolunteerCountProps {
  // When provided by the parent (via useBlockEvents includeStats), VolunteerCount
  // renders this value directly and skips its own /api/probe-events polling.
  externalVolunteerCount?: number | null
}

export default function VolunteerCount({ externalVolunteerCount }: VolunteerCountProps = {}) {
  const [count, setCount] = useState<number | null>(null)
  const [isResolved, setIsResolved] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef<number | null>(null)
  const failureCountRef = useRef(0)

  // When the parent supplies the volunteer count from the shared useBlockEvents
  // poll, apply it directly and skip the standalone polling effect below.
  useEffect(() => {
    if (externalVolunteerCount == null) {
      setIsResolved(false)
      setCount(null)
      return
    }
    const newCount = externalVolunteerCount
    if (prevCountRef.current !== newCount && liveRef.current) {
      liveRef.current.textContent = `${newCount.toLocaleString()} volunteer ${newCount === 1 ? 'node' : 'nodes'} now active`
    }
    prevCountRef.current = newCount
    setCount(newCount)
    setIsResolved(true)
  }, [externalVolunteerCount])

  useEffect(() => {
    // Skip standalone polling when the parent is supplying the count externally.
    // This eliminates the duplicate /api/probe-events?stats=true request that
    // would otherwise fire every 62s independently of the 30s useBlockEvents interval.
    if (externalVolunteerCount !== undefined) return

    let mounted = true
    let abortController = new AbortController()

    const fetchVolunteers = async () => {
      abortController.abort()
      abortController = new AbortController()
      const { signal } = abortController
      try {
        const res = await fetch('/api/probe-events?stats=true', { signal })
        if (!mounted) return
        if (res.ok) {
          const data: { volunteerCount?: number } = await res.json()
          if (mounted) {
            const newCount = data.volunteerCount ?? 0
            if (prevCountRef.current !== newCount && liveRef.current) {
              liveRef.current.textContent = `${newCount.toLocaleString()} volunteer ${newCount === 1 ? 'node' : 'nodes'} now active`
            }
            prevCountRef.current = newCount
            failureCountRef.current = 0
            setCount(newCount)
            setIsResolved(true)
            setIsStale(false)
          }
        } else {
          if (!mounted) return
          failureCountRef.current += 1
          if (failureCountRef.current >= 2) setIsStale(true)
          setIsResolved(r => r || true)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        if (!mounted) return
        failureCountRef.current += 1
        if (failureCountRef.current >= 2) setIsStale(true)
        setIsResolved(r => r || true)
      }
    }
    fetchVolunteers()
    const interval = setInterval(fetchVolunteers, 62_000)
    return () => {
      mounted = false
      abortController.abort()
      clearInterval(interval)
    }
  }, [externalVolunteerCount])

  const pillStyle = {
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.10)',
  }

  return (
    <>
      <div ref={liveRef} aria-live="polite" className="sr-only" />
      {/* Not yet resolved — show loading skeleton */}
      {!isResolved ? (
        <div
          role="img"
          aria-label="Loading volunteer count"
          className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs"
          style={pillStyle}
        >
          <span aria-hidden="true" className="inline-block h-1.5 w-24 rounded-full skeleton-shimmer" />
        </div>
      ) : count === null ? (
        /* First-load failed — show dash with tooltip */
        <div
          role="img"
          title="Could not load volunteer count"
          aria-label="Volunteer count unavailable"
          className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium"
          style={{ ...pillStyle, color: 'rgba(255,255,255,0.4)' }}
        >
          <span aria-hidden>— volunteers</span>
        </div>
      ) : (
        <div
          role="img"
          className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium"
          style={{ ...pillStyle, color: 'rgba(255,255,255,0.6)' }}
          aria-label={`${count.toLocaleString()} volunteer ${count === 1 ? 'node' : 'nodes'} active${isStale ? ' (offline)' : ''}`}
        >
          <span
            className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: isStale ? 'rgba(255,255,255,0.3)' : 'var(--wld-primary-pink, #9d50ff)' }}
            aria-hidden
          />
          <span aria-hidden>
            <strong style={{ color: '#ffffff', fontWeight: 600 }}>{count.toLocaleString()}</strong>
            <span style={{ color: 'rgba(255,255,255,0.60)' }}> volunteers</span>
            {isStale && <span style={{ color: 'rgba(255,255,255,0.35)' }}> (offline)</span>}
          </span>
        </div>
      )}
    </>
  )
}
