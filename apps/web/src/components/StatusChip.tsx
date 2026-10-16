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
    bg: '#fff6e6',
    text: '#996800',
  },
  tcp_rst: {
    label: 'TCP Reset',
    bg: '#fee9e7',
    text: '#c2200a',
  },
  http_block: {
    label: 'HTTP Block',
    bg: '#fee9e7',
    text: '#c2200a',
  },
  full_unreachable: {
    label: 'Unreachable',
    bg: '#fee9e7',
    text: '#c2200a',
  },
  reachable: {
    label: 'Reachable',
    bg: '#e6f9ec',
    text: '#00741d',
  },
}

export default memo(function StatusChip({ blockType, className = '' }: StatusChipProps) {
  const key = blockType ?? 'reachable'
  const config = CHIP_CONFIG[key] ?? CHIP_CONFIG.reachable!

  return (
    <span
      className={`inline-flex h-7 items-center rounded-full px-3 text-[13px] font-medium ${className}`}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  )
})
