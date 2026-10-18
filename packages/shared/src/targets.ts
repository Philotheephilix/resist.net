import { createHash } from 'crypto'

export const TARGETS = [
  'https://twitter.com',
  'https://instagram.com',
  'https://youtube.com',
  'https://wikipedia.org',
  'https://signal.org',
]

export const TARGETS_HASH = createHash('sha256')
  .update([...TARGETS].sort().join('\n'))
  .digest('hex')
