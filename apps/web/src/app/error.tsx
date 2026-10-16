'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4"
      style={{ backgroundColor: '#0a0a0a', color: '#ffffff' }}
    >
      <div
        className="flex flex-col items-center gap-3 rounded-2xl px-8 py-6 text-sm"
        style={{
          background: 'rgba(242,40,13,0.10)',
          border: '1px solid rgba(242,40,13,0.25)',
          color: 'rgba(255,255,255,0.75)',
        }}
      >
        <span style={{ fontSize: '1.25rem', color: '#ff6b55' }}>⚠</span>
        <p style={{ margin: 0 }}>Something went wrong. Please try again.</p>
        <button
          onClick={reset}
          className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150"
          style={{
            background: 'rgba(255,255,255,0.10)',
            border: '1px solid rgba(255,255,255,0.16)',
            color: '#ffffff',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
