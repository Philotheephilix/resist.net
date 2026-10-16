'use client'

import { useEffect, useRef, useState } from 'react'

export default function VolunteerCount() {
  const [count, setCount] = useState<number | null>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true
    let abortController = new AbortController()

    // Fetch volunteerCount from the shared stats endpoint so this component
    // does not run an independent polling loop. NodeCount polls the same
    // endpoint on a 62s interval; the server caches the response for 60s,
    // so both components share a single effective request cadence.
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
              liveRef.current.textContent = `${newCount} volunteer ${newCount === 1 ? 'node' : 'nodes'} now active`
            }
            prevCountRef.current = newCount
            setCount(newCount)
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        // silently ignore — volunteer count is best-effort
      }
    }
    fetchVolunteers()
    const interval = setInterval(fetchVolunteers, 62_000)
    return () => {
      mounted = false
      abortController.abort()
      clearInterval(interval)
    }
  }, [])

  if (count === null) return null

  return (
    <>
    <div ref={liveRef} aria-live="polite" aria-atomic="true" className="sr-only" />
    <div
      role="img"
      className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium"
      style={{
        background: 'rgba(255,255,255,0.07)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: 'rgba(255,255,255,0.6)',
      }}
      aria-label={`${count} volunteer ${count === 1 ? 'node' : 'nodes'} active`}
    >
      <span
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: '#7c6ff7' }}
        aria-hidden
      />
      <span aria-hidden>
        <strong style={{ color: '#ffffff', fontWeight: 600 }}>{count}</strong>
        <span style={{ color: 'rgba(255,255,255,0.60)' }}> volunteers</span>
      </span>
    </div>
    </>
  )
}
