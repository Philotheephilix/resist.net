'use client'

import { useEffect, useState } from 'react'

interface VolunteerEntry {
  wallet: string
  geohash: string | null
  capacitySlots: number
  createdAt: string
}

export default function VolunteerCount() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true
    const fetchVolunteers = async () => {
      try {
        const res = await fetch('/api/bootstrap')
        if (!mounted) return
        if (res.ok) {
          const data: VolunteerEntry[] = await res.json()
          if (mounted) setCount(data.length)
        }
      } catch {
        // silently ignore — volunteer count is best-effort
      }
    }
    fetchVolunteers()
    const interval = setInterval(fetchVolunteers, 120_000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  if (count === null) return null

  return (
    <div
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
  )
}
