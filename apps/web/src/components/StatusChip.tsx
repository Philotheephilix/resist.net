'use client'

import { memo } from 'react'

export type BlockType = 'dns_poisoning' | 'tcp_rst' | 'http_block' | 'full_unreachable' | null

interface StatusChipProps {
  blockType: BlockType
  className?: string
}

const CHIP_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  dns_poisoning: {
    label: 'DNS Poisoning',
    bg: 'var(--wld-warning-100)',
    text: 'var(--wld-warning-800)',
  },
  tcp_rst: {
    label: 'TCP Reset',
    bg: 'var(--wld-error-100)',
    text: 'var(--wld-error-700)',
  },
  http_block: {
    label: 'HTTP Block',
    bg: 'var(--wld-error-100)',
    text: 'var(--wld-error-700)',
  },
  full_unreachable: {
    label: 'Unreachable',
    bg: 'var(--wld-error-100)',
    text: 'var(--wld-error-700)',
  },
  reachable: {
    label: 'Reachable',
    bg: 'var(--wld-success-100)',
    text: 'var(--wld-success-800)',
  },
}

export default memo(function StatusChip({ blockType, className = '' }: StatusChipProps) {
  const key = blockType ?? 'reachable'
  const config = CHIP_CONFIG[key] ?? CHIP_CONFIG.reachable

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  )
})
