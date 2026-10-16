'use client'

import { memo } from 'react'

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

const LABEL_STYLE_ACTIVE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.14)',
  color: '#ffffff',
  border: '1px solid rgba(255,255,255,0.20)',
  boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
  transition: 'background-color 150ms cubic-bezier(0.16,1,0.3,1), color 150ms cubic-bezier(0.16,1,0.3,1), border-color 150ms cubic-bezier(0.16,1,0.3,1)',
}
const LABEL_STYLE_INACTIVE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(255,255,255,0.07)',
  transition: 'background-color 150ms cubic-bezier(0.16,1,0.3,1), color 150ms cubic-bezier(0.16,1,0.3,1), border-color 150ms cubic-bezier(0.16,1,0.3,1)',
}

export default memo(function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <fieldset
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none', border: 'none', padding: 0, margin: 0 }}
    >
      <legend className="sr-only">Filter events by block type</legend>

      {FILTERS.map(({ key, label }) => {
        const isActive = active === key
        return (
          <label
            key={key}
            className="filter-option flex-shrink-0 cursor-pointer rounded-full select-none"
            style={isActive ? LABEL_STYLE_ACTIVE : LABEL_STYLE_INACTIVE}
          >
            {/* Visually hidden radio input — clicking the label activates it */}
            <input
              type="radio"
              name="filter"
              value={key}
              checked={isActive}
              onChange={() => onChange(key)}
              className="sr-only peer"
            />
            <span className="flex items-center px-3.5 min-h-[44px] text-xs font-semibold tracking-wide peer-focus-visible:ring-2 peer-focus-visible:ring-white/40 rounded-full">
              {label}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
})
