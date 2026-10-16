'use client'

import { useRef, KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'

export type FilterType = 'all' | 'dns_poisoning' | 'tcp_rst' | 'http_block' | 'full_unreachable'

interface FilterBarProps {
  active: FilterType
  onChange: (filter: FilterType) => void
}

const FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'dns_poisoning', label: 'DNS Poisoning' },
  { key: 'tcp_rst', label: 'TCP Reset' },
  { key: 'http_block', label: 'HTTP Block' },
  { key: 'full_unreachable', label: 'Unreachable' },
]

export default function FilterBar({ active, onChange }: FilterBarProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const currentIdx = FILTERS.findIndex((f) => f.key === active)
    const buttons = () => containerRef.current?.querySelectorAll('button[role="radio"]')
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = (currentIdx + 1) % FILTERS.length
      // flushSync forces React to re-render synchronously before we call .focus(),
      // so the newly active button already has tabIndex=0 when focus is moved.
      flushSync(() => { onChange(FILTERS[next]!.key) })
      ;(buttons()?.[next] as HTMLElement | undefined)?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = (currentIdx - 1 + FILTERS.length) % FILTERS.length
      flushSync(() => { onChange(FILTERS[prev]!.key) })
      ;(buttons()?.[prev] as HTMLElement | undefined)?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      flushSync(() => { onChange(FILTERS[0]!.key) })
      ;(buttons()?.[0] as HTMLElement | undefined)?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      flushSync(() => { onChange(FILTERS[FILTERS.length - 1]!.key) })
      ;(buttons()?.[FILTERS.length - 1] as HTMLElement | undefined)?.focus()
    }
  }

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Filter events by block type"
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' }}
      onKeyDown={handleKeyDown}
    >
      {FILTERS.map(({ key, label }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(key)}
            className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-white/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            style={{
              backgroundColor: isActive ? 'var(--wld-gray-0)' : 'var(--wld-glass-bg-muted)',
              color: isActive ? 'var(--wld-gray-900)' : 'var(--wld-gray-300)',
              border: isActive
                ? '1px solid var(--wld-gray-0)'
                : '1px solid var(--wld-glass-bg-active)',
              cursor: 'pointer',
              transitionDuration: 'var(--wld-duration-base)',
              transitionTimingFunction: 'var(--wld-ease-default)',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
