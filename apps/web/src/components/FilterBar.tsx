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

// World UI Kit Pill pattern — active: dark fill, inactive: transparent with border
const LABEL_STYLE_ACTIVE: React.CSSProperties = {
  backgroundColor: '#181818',
  color: '#ffffff',
  border: '1px solid #181818',
  transition: 'background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
}
const LABEL_STYLE_INACTIVE: React.CSSProperties = {
  backgroundColor: 'transparent',
  color: '#181818',
  border: '1px solid #ebecef',
  transition: 'background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)',
}

export default memo(function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter events by block type"
      className="flex items-center gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {FILTERS.map(({ key, label }) => {
        const isActive = active === key
        return (
          <label
            key={key}
            className="flex-shrink-0 cursor-pointer rounded-full"
            style={isActive ? LABEL_STYLE_ACTIVE : LABEL_STYLE_INACTIVE}
          >
            {/* Visually hidden radio input — clicking the label activates it */}
            <input
              type="radio"
              name="filter"
              value={key}
              checked={isActive}
              onChange={() => onChange(key)}
              className="sr-only"
            />
            <span className="block px-3 py-1.5 text-xs font-semibold focus-within:ring-2 focus-within:ring-[#181818]/30 focus-within:rounded-full">
              {label}
            </span>
          </label>
        )
      })}
    </div>
  )
})
