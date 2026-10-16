export default function Loading() {
  return (
    <div
      className="flex h-screen w-full items-center justify-center"
      style={{ backgroundColor: '#0a0a0a' }}
    >
      <div
        className="flex items-center gap-3 rounded-full px-5 py-2.5 text-sm"
        style={{
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(255,255,255,0.5)',
        }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#00c230' }} />
        Loading…
      </div>
    </div>
  )
}
