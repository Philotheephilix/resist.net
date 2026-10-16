'use client'

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
  return (
    // role=radiogroup with native <input type="radio"> elements gives full AT support
    // across all assistive technology versions — JAWS, NVDA, VoiceOver on iOS/macOS.
    // Native inputs handle arrow-key navigation, aria-checked semantics, and group
    // name announcement without needing ARIA role overrides on non-radio elements.
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
            style={{
              backgroundColor: isActive ? 'var(--wld-gray-0)' : 'var(--wld-glass-bg-muted)',
              color: isActive ? 'var(--wld-gray-900)' : 'var(--wld-gray-300)',
              border: isActive
                ? '1px solid var(--wld-gray-0)'
                : '1px solid var(--wld-glass-bg-active)',
              transitionDuration: 'var(--wld-duration-base)',
              transitionTimingFunction: 'var(--wld-ease-default)',
              transition: 'background-color var(--wld-duration-base) var(--wld-ease-default)',
            }}
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
            <span
              className="block px-3 py-1.5 text-xs font-semibold focus-within:ring-2 focus-within:ring-white/50 focus-within:rounded-full"
              aria-hidden="true"
            >
              {label}
            </span>
          </label>
        )
      })}
    </div>
  )
}
