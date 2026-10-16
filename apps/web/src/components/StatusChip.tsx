'use client'

import { memo } from 'react'

export type BlockType = 'dns_poisoning' | 'tcp_rst' | 'http_block' | 'full_unreachable' | null

interface StatusChipProps {
  blockType: BlockType
  className?: string
}

const CHIP_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  dns_poisoning: {
    label: 'DNS Poisoning',
    bg: 'rgba(255,174,0,0.12)',
    text: '#ffb733',
    dot: '#ffae00',
  },
  tcp_rst: {
    label: 'TCP Reset',
    bg: 'rgba(242,40,13,0.12)',
    text: '#ff6b55',
    dot: '#f2280d',
  },
  http_block: {
    label: 'HTTP Block',
    bg: 'rgba(242,40,13,0.12)',
    text: '#ff6b55',
    dot: '#f2280d',
  },
  full_unreachable: {
    label: 'Unreachable',
    bg: 'rgba(242,40,13,0.10)',
    text: 'rgba(255,107,85,0.85)',
    dot: '#f2280d',
  },
  reachable: {
    label: 'Reachable',
    bg: 'rgba(0,194,48,0.10)',
    text: '#33d167',
    dot: '#00c230',
  },
}

export default memo(function StatusChip({ blockType, className = '' }: StatusChipProps) {
  const key = blockType ?? 'reachable'
  const config = CHIP_CONFIG[key] ?? CHIP_CONFIG.reachable!

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold tracking-wide ${className}`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      <span
        className="inline-block h-1 w-1 flex-shrink-0 rounded-full"
        style={{ backgroundColor: config.dot }}
        aria-hidden
      />
      {config.label}
    </span>
  )
})
