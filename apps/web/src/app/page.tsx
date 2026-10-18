'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, useCallback, useRef, useEffect, useDeferredValue, memo } from 'react'
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Clock3,
  Copy,
  Globe2,
  Home,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  Network,
  Search,
  Shield,
  TrendingUp,
  Wallet,
  Wifi,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { usePrivy } from '../hooks/usePrivyCompat'
import { useBlockEvents } from '../hooks/useBlockEvents'
import type { TestUrlResult } from './api/test-url/route'

const Globe = dynamic(() => import('react-globe.gl'), { ssr: false, loading: () => <div role="status" aria-label="Loading globe" style={{width:295,height:295,display:'flex',alignItems:'center',justifyContent:'center'}}><Loader2 size={32} className="spin-loader" /></div> })

const POLY_CAP_COLOR = () => 'rgba(28, 31, 34, 0.92)'
const POLY_SIDE_COLOR = () => 'rgba(18, 20, 22, 0.45)'
const POLY_STROKE_COLOR = () => 'rgba(255,255,255,0.18)'
const ARC_COLOR_VALUE = ['#19c35c', '#87e8a8']
const ARC_COLOR = () => ARC_COLOR_VALUE

type Tab = 'radar' | 'network' | 'connect' | 'activity'

const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'radar', label: 'Radar', icon: Home },
  { id: 'network', label: 'Network', icon: Activity },
  { id: 'connect', label: 'Connect', icon: TrendingUp },
  { id: 'activity', label: 'Activity', icon: Clock3 },
]

const DEFAULT_ARCS = [
  { startLat: 19.07, startLng: 72.87, endLat: 51.5, endLng: -0.12 },
  { startLat: 19.07, startLng: 72.87, endLat: 40.71, endLng: -74 },
  { startLat: -6.2, startLng: 106.8, endLat: 19.07, endLng: 72.87 },
]

const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz'
function geohashToLatLng(hash: string): { lat: number; lng: number } | null {
  if (!hash) return null
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180, isLng = true
  for (const ch of hash) {
    const idx = GEOHASH_CHARS.indexOf(ch)
    if (idx < 0) return null
    for (let bits = 4; bits >= 0; bits--) {
      const bit = (idx >> bits) & 1
      if (isLng) { const mid = (minLng + maxLng) / 2; if (bit) minLng = mid; else maxLng = mid }
      else { const mid = (minLat + maxLat) / 2; if (bit) minLat = mid; else maxLat = mid }
      isLng = !isLng
    }
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  dns_poisoning: 'DNS Poisoning',
  tcp_rst: 'TCP Reset',
  http_block: 'HTTP Block',
  full_unreachable: 'Unreachable',
}

function statusLabel(blockType: string | null, reachable: boolean): string {
  if (reachable) return 'Reachable'
  if (!blockType) return 'Blocked'
  return BLOCK_TYPE_LABELS[blockType] ?? blockType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function statusColor(blockType: string | null, reachable: boolean): 'green' | 'amber' | 'red' {
  if (reachable) return 'green'
  if (blockType === 'dns_poisoning') return 'amber'
  return 'red'
}

function timeAgo(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/** Truncate an Ethereum address: 0xAbCd…1234 */
function truncAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Two-letter initials from a wallet address for the avatar */
function walletInitials(addr: string): string {
  if (!addr) return 'R'
  return addr.slice(2, 4).toUpperCase()
}

/** Deterministic hue from address for avatar background */
function addrHue(addr: string): string {
  if (!addr) return '#ffe3ee'
  const n = parseInt(addr.slice(2, 8), 16) || 0
  const hue = n % 360
  return `hsl(${hue}, 80%, 88%)`
}

function addrFg(addr: string): string {
  if (!addr) return '#e65c90'
  const n = parseInt(addr.slice(2, 8), 16) || 0
  const hue = n % 360
  return `hsl(${hue}, 60%, 35%)`
}

// ─── Header ───────────────────────────────────────────────────────────────────

const Header = memo(function Header({ onAvatarClick }: { onAvatarClick: () => void }) {
  const { ready, authenticated, user } = usePrivy()

  const walletAddr = user?.wallet?.address ?? ''
  const initials = authenticated && walletAddr ? walletInitials(walletAddr) : 'R'
  const bg = authenticated && walletAddr ? addrHue(walletAddr) : '#ffe3ee'
  const fg = authenticated && walletAddr ? addrFg(walletAddr) : '#e65c90'

  return (
    <header className="topbar">
      <button
        className="profile"
        style={{ background: bg, color: fg, border: 'none', cursor: 'pointer' }}
        onClick={onAvatarClick}
        aria-label={authenticated && walletAddr && ready ? `Wallet: ${truncAddr(walletAddr)}` : authenticated ? 'Account' : 'Sign in'}
        title={authenticated ? walletAddr : 'Sign in with Ethereum'}
      >
        {!ready ? '…' : initials}
      </button>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><Network size={16} /></span>
        <span>ResistNet</span>
      </div>
    </header>
  )
})

// ─── Globe ────────────────────────────────────────────────────────────────────

const DEFAULT_POINTS = [
  { lat: 19.07, lng: 72.87, size: 0.16, color: '#18b957' },
  { lat: -6.2, lng: 106.8, size: 0.13, color: '#f3ad24' },
  { lat: 40.71, lng: -74, size: 0.13, color: '#18b957' },
  { lat: 51.5, lng: -0.12, size: 0.11, color: '#18b957' },
  { lat: -23.55, lng: -46.63, size: 0.11, color: '#f3ad24' },
]

function DottedGlobe({ compact = false, points, arcs }: {
  compact?: boolean
  points?: Array<{ lat: number; lng: number; size: number; color: string }>
  arcs?: Array<{ startLat: number; startLng: number; endLat: number; endLng: number }>
}) {
  const [autoRotate, setAutoRotate] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [countryFeatures, setCountryFeatures] = useState<object[]>([])
  useEffect(() => {
    Promise.all([
      import('topojson-client'),
      import('world-atlas/countries-110m.json'),
    ]).then(([{ feature }, countries]) => {
      setCountryFeatures((feature as (t: unknown, o: unknown) => { features: object[] })(countries, (countries as { objects: { countries: unknown } }).objects.countries).features)
    }).catch(err => console.error('Failed to load world atlas', err))
  }, [])
  const displayPoints = useMemo(() => points ?? DEFAULT_POINTS, [points])
  const handleGlobeClick = useCallback(() => setAutoRotate(false), [])
  const controlsOptions = useMemo(() => ({
    enableDamping: true,
    dampingFactor: 0.08,
    autoRotate,
    autoRotateSpeed: 0.35,
    minDistance: 185,
    maxDistance: 430,
  }), [autoRotate])

  return (
    <div
      ref={wrapRef}
      className={`globe-wrap ${compact ? 'compact' : ''}`}
      role="img"
      aria-label="Live network globe showing active connections."
      onPointerDown={() => { if (wrapRef.current) wrapRef.current.style.willChange = 'transform' }}
      onPointerUp={() => { if (wrapRef.current && !autoRotate) wrapRef.current.style.willChange = 'auto' }}
    >
      <Globe
        width={295}
        height={295}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/resistnet-world-globe.png"
        polygonsData={countryFeatures as object[]}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={POLY_CAP_COLOR}
        polygonSideColor={POLY_SIDE_COLOR}
        polygonStrokeColor={POLY_STROKE_COLOR}
        polygonAltitude={0.008}
        showAtmosphere
        atmosphereColor="#9fe8ba"
        atmosphereAltitude={0.12}
        pointsData={displayPoints}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointAltitude={0.025}
        pointRadius="size"
        pointResolution={16}
        arcsData={arcs ?? DEFAULT_ARCS}
        arcColor={ARC_COLOR}
        arcAltitude={0.18}
        arcStroke={0.45}
        arcDashLength={0.35}
        arcDashGap={1.1}
        arcDashAnimateTime={1600}
        enablePointerInteraction
        animateIn
        // @ts-expect-error controlsOptions valid prop, missing from type defs
        controlsOptions={controlsOptions}
        onGlobeClick={handleGlobeClick}
      />
      <button
        className="globe-hint"
        type="button"
        onClick={() => setAutoRotate(v => !v)}
        aria-label={autoRotate ? 'Pause globe rotation' : 'Resume globe rotation'}
      >
        {autoRotate ? 'Drag to explore' : 'Rotation paused'}
      </button>
    </div>
  )
}

function StatusLine({ children = 'Network live' }: { children?: string }) {
  return (
    <p className="status-line">
      <span className="live-dot" aria-hidden="true" />
      {children}
    </p>
  )
}

const MiniChart = memo(function MiniChart({ events }: { events?: { timestamp: number }[] }) {
  const path = useMemo(() => {
    if (!events || events.length === 0) return null
    const W = 500
    const H = 108
    const BUCKETS = 20
    const now = Date.now()
    const windowMs = 60 * 60 * 1000
    const counts = new Array<number>(BUCKETS).fill(0)
    for (const e of events) {
      const age = now - e.timestamp
      if (age < 0 || age > windowMs) continue
      const idx = Math.min(BUCKETS - 1, Math.floor(((windowMs - age) / windowMs) * BUCKETS))
      counts[idx]++
    }
    const max = Math.max(...counts, 1)
    const pts = counts.map((c, i) => {
      const x = (i / (BUCKETS - 1)) * W
      const y = H - 8 - ((c / max) * (H - 16))
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    return `M${pts.join(' L')}`
  }, [events])

  const hasData = path !== null
  return (
    <div
      className="mini-chart"
      aria-hidden="true"
    >
      <svg viewBox="0 0 500 108" preserveAspectRatio="none">
        {hasData
          ? <path d={path} />
          : <path d="M0 76 C28 69 35 88 64 75 S95 62 116 74 S145 88 168 72 S197 67 220 79 S245 83 265 65 S284 55 300 63 S312 80 325 42 S342 52 360 35 S388 52 406 31 S428 62 448 48 S470 56 500 24" opacity="0.35" />
        }
      </svg>
    </div>
  )
})

// ─── Focus trap hook ──────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function useFocusTrap(panelRef: { current: HTMLElement | null }, onClose: () => void) {
  const triggerRef = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    triggerRef.current = document.activeElement
    const panel = panelRef.current
    if (!panel) return
    if (!panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const focusable = Array.from(panel!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.closest('[inert]'))
      if (!focusable.length) { e.preventDefault(); return }
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      } else {
        if (document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      ;(triggerRef.current as HTMLElement | null)?.focus()
    }
  }, [panelRef.current])
}

// ─── Test URL modal ────────────────────────────────────────────────────────────

type TestMethod = 'HTTP' | 'DNS' | 'TCP'

function TestUrlModal({ onClose, initialUrl }: { onClose: () => void; initialUrl?: string }) {
  const { user } = usePrivy()
  const walletAddr = user?.wallet?.address ?? ''
  const [urlInput, setUrlInput] = useState(initialUrl ?? '')
  const [method, setMethod] = useState<TestMethod>('HTTP')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestUrlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Queue section
  const [queueOpen, setQueueOpen] = useState(false)
  const [qVolunteers, setQVolunteers] = useState(3)
  const [qRepeat, setQRepeat] = useState(3)
  const [qInterval, setQInterval] = useState(60)
  const [qPayment, setQPayment] = useState(0.1)
  const [qSubmitting, setQSubmitting] = useState(false)
  const [qSuccess, setQSuccess] = useState(false)
  const [qError, setQError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  useFocusTrap(panelRef, onClose)

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const runTest = useCallback(async () => {
    const raw = urlInput.trim()
    if (!raw) { inputRef.current?.focus(); return }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (res.ok || res.status === 501) {
        setResult(data as TestUrlResult)
      } else {
        setError(data.error ?? 'Test failed')
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRunning(false)
    }
  }, [urlInput, method])

  const submitQueue = useCallback(async () => {
    const raw = urlInput.trim()
    if (!raw) return
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (!walletAddr) { setQError('Connect your wallet first'); return }
    setQSubmitting(true)
    setQSuccess(false)
    setQError(null)
    try {
      const res = await fetch('/api/probe-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: url,
          volunteerCount: qVolunteers,
          repeatCount: qRepeat,
          intervalSeconds: qInterval,
          paymentGlm: qPayment,
          requesterWallet: walletAddr,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setQSuccess(true)
      } else {
        setQError(data.error ?? 'Submission failed')
      }
    } catch {
      setQError('Network error')
    } finally {
      setQSubmitting(false)
    }
  }, [urlInput, walletAddr, qVolunteers, qRepeat, qInterval, qPayment])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} className="test-modal" role="dialog" aria-modal="true" aria-labelledby="test-modal-title" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close"><X /></button>
        <h2 id="test-modal-title">Test a URL</h2>
        <p>Check availability from a volunteer region.</p>

        <div className={`input-field ${urlInput ? 'active' : ''}`}>
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            type="url"
            placeholder="https://example.com"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runTest() }}
            autoFocus
            autoComplete="url"
            aria-label="URL to test"
          />
        </div>

        <div className="method-row" role="group" aria-label="Test method">
          {(['HTTP', 'DNS', 'TCP'] as TestMethod[]).map(m => (
            <button
              key={m}
              className={method === m ? 'selected' : ''}
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
            >
              {m}
            </button>
          ))}
        </div>

        <button
          className="primary-button"
          onClick={runTest}
          disabled={running || !urlInput.trim()}
          aria-busy={running}
        >
          {running ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
              Running test…
            </span>
          ) : 'Run test'}
        </button>

        {error && (
          <div className="test-result error" role="alert">
            <b>Error</b>
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className={`test-result ${result.reachable === null ? '' : result.reachable ? 'success' : 'error'}`} role="status">
            <b>
              {result.notSupported
                ? 'Not yet supported'
                : result.reachable === true
                ? <><span aria-hidden="true">✓</span><span className="sr-only">Pass:</span> Reachable</>
                : result.reachable === false
                ? <><span aria-hidden="true">✗</span><span className="sr-only">Fail:</span> {statusLabel(result.errorType ?? null, false)}</>
                : null}
            </b>
            <span>
              {result.method} · {result.region}
              {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ''}
              {result.statusCode != null ? ` · HTTP ${result.statusCode}` : ''}
            </span>
            {result.errorDetail && (
              <span style={{ marginTop: 6, color: '#c0392b', fontSize: 12 }}>{result.errorDetail}</span>
            )}
            {result.notSupported && (
              <span style={{ marginTop: 6 }}>{result.errorDetail}</span>
            )}
          </div>
        )}

        {/* ── Queue for network section ── */}
        <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <button
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#222', fontWeight: 600 }}
            onClick={() => setQueueOpen(v => !v)}
            aria-expanded={queueOpen}
            aria-controls="queue-panel"
          >
            <Network size={16} aria-hidden="true" />
            Queue for network probing
            <ChevronDown size={14} aria-hidden="true" style={{ marginLeft: 'auto', transform: queueOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
          </button>
          {queueOpen && (
            <div id="queue-panel" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ color: '#666', fontSize: 12, margin: 0 }}>
                Request volunteer nodes to probe this URL on-chain. Pay GLM to reward participating nodes.
              </p>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Volunteer nodes <b>{qVolunteers}</b>
                </span>
                <input type="range" min={1} max={20} value={qVolunteers} onChange={e => setQVolunteers(Number(e.target.value))} style={{ width: '100%', marginTop: 4 }} aria-label="Number of volunteer nodes" />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Repeat probes <b>{qRepeat}×</b>
                </span>
                <input type="range" min={1} max={10} value={qRepeat} onChange={e => setQRepeat(Number(e.target.value))} style={{ width: '100%', marginTop: 4 }} aria-label="Number of repeat probes per node" />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  Probe interval <b>{qInterval}s</b>
                </span>
                <input type="range" min={30} max={3600} step={30} value={qInterval} onChange={e => setQInterval(Number(e.target.value))} style={{ width: '100%', marginTop: 4 }} aria-label="Interval between probes in seconds" />
              </label>
              <label style={{ fontSize: 13 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  GLM reward <b>{qPayment.toFixed(3)} GLM</b>
                </span>
                <input type="range" min={0.001} max={10} step={0.001} value={qPayment} onChange={e => setQPayment(Number(e.target.value))} style={{ width: '100%', marginTop: 4 }} aria-label="GLM payment for participating nodes" />
              </label>
              <div style={{ fontSize: 12, color: '#888', background: '#f7f7f7', borderRadius: 8, padding: '8px 12px' }}>
                {qVolunteers} node{qVolunteers !== 1 ? 's' : ''} · {qRepeat} probe{qRepeat !== 1 ? 's' : ''} each · every {qInterval}s · {qPayment.toFixed(3)} GLM total
              </div>
              {qSuccess ? (
                <div className="test-result success" role="status">
                  <b><span aria-hidden="true">✓</span><span className="sr-only">Success:</span> Job queued</b>
                  <span>Volunteer nodes will pick this up automatically.</span>
                </div>
              ) : (
                <button
                  className="primary-button"
                  onClick={submitQueue}
                  disabled={qSubmitting || !urlInput.trim() || !walletAddr}
                  aria-busy={qSubmitting}
                  title={!walletAddr ? 'Connect your wallet first' : undefined}
                >
                  {qSubmitting ? (
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                      Submitting…
                    </span>
                  ) : `Queue job · ${qPayment.toFixed(3)} GLM`}
                </button>
              )}
              {qError && (
                <div className="test-result error" role="alert"><b>Error</b><span>{qError}</span></div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Wallet login sheet ───────────────────────────────────────────────────────

function WalletSheet({ onClose }: { onClose: () => void }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const walletAddr = user?.wallet?.address ?? ''
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const [privyTimedOut, setPrivyTimedOut] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  useEffect(() => {
    setPrivyTimedOut(false)
    if (ready) return
    const id = setTimeout(() => setPrivyTimedOut(true), 10000)
    return () => clearTimeout(id)
  }, [ready])
  useFocusTrap(panelRef, onClose)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} className="test-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close"><X /></button>

        <h2 id="wallet-modal-title" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>Wallet details</h2>
        {!ready ? (
          <div aria-live="polite" aria-atomic="true" style={{ padding: '24px 0', textAlign: 'center', color: '#666' }}>
            {privyTimedOut ? (
              <>
                <p style={{ margin: 0, fontSize: 14 }}>Could not connect to authentication service — please try again.</p>
                <button onClick={onClose} style={{ marginTop: 12, fontSize: 13, padding: '6px 16px', cursor: 'pointer' }}>Dismiss</button>
              </>
            ) : (
              <>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto' }} />
                      </>
            )}
          </div>
        ) : authenticated && walletAddr ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, marginTop: 8 }}>
              <div
                className="profile large"
                style={{
                  width: 56, height: 56, fontSize: 20, flexShrink: 0,
                  background: addrHue(walletAddr), color: addrFg(walletAddr),
                }}
                aria-hidden="true"
              >
                {walletInitials(walletAddr)}
              </div>
              <div>
                <b style={{ fontSize: 18, display: 'block' }}>Connected</b>
                <code
                  style={{
                    fontSize: 13, color: '#555', background: '#f5f5f5',
                    padding: '3px 8px', borderRadius: 8, display: 'block', marginTop: 6,
                    fontFamily: 'monospace', letterSpacing: '0.04em',
                  }}
                  title={walletAddr}
                >
                  {truncAddr(walletAddr)}
                </code>
              </div>
            </div>

            <div className="health-row" style={{ marginBottom: 0 }}>
              <span style={{ color: '#888', fontSize: 13 }}>Full address</span>
              <button
                style={{
                  fontSize: 11, color: copied ? '#22a85a' : '#444', fontFamily: 'monospace',
                  maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  cursor: 'pointer', background: 'none', border: 'none', padding: 0,
                  textAlign: 'left',
                }}
                title={walletAddr}
                aria-label="Copy full address"
                onClick={() => { navigator.clipboard?.writeText(walletAddr); setCopied(true) }}
              >
                {copied ? 'Copied!' : walletAddr}
              </button>
            </div>
            {user?.wallet?.chainType && (
              <div className="health-row">
                <span style={{ color: '#888', fontSize: 13 }}>Network</span>
                <b style={{ fontSize: 13, textTransform: 'capitalize' }}>{user.wallet.chainType}</b>
              </div>
            )}

            <button
              className="primary-button"
              style={{ background: '#f7f7f7', color: '#111', marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onClick={async () => { await logout(); onClose() }}
            >
              <LogOut size={18} aria-hidden="true" />
              Disconnect wallet
            </button>
          </>
        ) : (
          <>
            <h2 id="wallet-modal-title" style={{ marginBottom: 8 }}>Connect wallet</h2>
            <p style={{ color: '#888', marginBottom: 24 }}>Sign in with your Ethereum wallet to track your probe history and volunteer node.</p>
            <button
              className="primary-button"
              onClick={login}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
            >
              <Wallet size={20} aria-hidden="true" />
              Sign in with Ethereum
            </button>
            <p style={{ color: '#666', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
              Powered by Privy · Your keys, your control
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Radar tab ─────────────────────────────────────────────────────────────────

function Radar({ onTest, onConnect, onViewNetwork, liveProbes, regions, blocksToday, loading, error, events }: {
  onTest: () => void
  onConnect: () => void
  onViewNetwork: () => void
  liveProbes: number
  regions: number
  blocksToday: number
  loading: boolean
  error: string | null
  events: { timestamp: number; geohash?: string | null; reachable?: boolean }[]
}) {
  const { globePoints, globeArcs } = useMemo(() => {
    const pts: Array<{ lat: number; lng: number; size: number; color: string }> = []
    const seen = new Set<string>()
    for (const e of events) {
      if (!e.geohash) continue
      const key = e.geohash.slice(0, 5)
      if (seen.has(key)) continue
      seen.add(key)
      const ll = geohashToLatLng(e.geohash)
      if (!ll) continue
      pts.push({ lat: ll.lat, lng: ll.lng, size: 0.13, color: e.reachable === false ? '#f3ad24' : '#18b957' })
    }
    if (pts.length === 0) return { globePoints: undefined, globeArcs: undefined }
    const arcs = pts.slice(0, pts.length - 1).map((p, i) => ({
      startLat: p.lat, startLng: p.lng,
      endLat: pts[i + 1].lat, endLng: pts[i + 1].lng,
    }))
    return { globePoints: pts, globeArcs: arcs }
  }, [events])

  return (
    <>
      <section className="hero-block">
        <h1>Network Radar</h1>
        <StatusLine>{loading ? 'Loading…' : error ? 'Connection error' : 'Network live'}</StatusLine>
        <div className="globe-button">
          <DottedGlobe points={globePoints} arcs={globeArcs} />
        </div>
        <div className="stats-row" aria-busy={loading}>
          {loading && <span className="sr-only">Loading statistics</span>}
          <div>
            <strong>
              {loading
                ? <span className="skeleton" aria-hidden="true" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
                : liveProbes.toLocaleString()}
            </strong>
            <span>Online nodes</span>
          </div>
          <div>
            <strong>
              {loading
                ? <span className="skeleton" aria-hidden="true" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
                : blocksToday.toLocaleString()}
            </strong>
            <span>Active incidents</span>
          </div>
          <div>
            <strong>
              {loading
                ? <span className="skeleton" aria-hidden="true" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
                : regions.toLocaleString()}
            </strong>
            <span>Regions monitored</span>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Network activity</h2>
          <button className="more-link" onClick={onViewNetwork} aria-label="View network activity details">View details <ChevronRight size={16} /></button>
        </div>
        <MiniChart events={events} />
        <div className="range-row"><span className="range-label">Last hour</span></div>
      </section>

      <div className="action-stack">
        <button className="action-card" onClick={onTest} aria-label="Test a URL">
          <span className="action-icon"><Search size={22} aria-hidden="true" /></span>
          <span>
            <b>Test a URL</b>
            <small>Check availability from a region</small>
          </span>
          <ChevronRight aria-hidden="true" />
        </button>
        <button className="action-card" onClick={onConnect} aria-label="Connect to network">
          <span className="action-icon connected"><Wifi size={22} aria-hidden="true" /></span>
          <span>
            <b>Connect to network</b>
            <small>Route traffic through ResistNet</small>
          </span>
        </button>
      </div>
    </>
  )
}

// ─── URL health drawer ─────────────────────────────────────────────────────────

function timeAgoShort(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function UrlHealthDrawer({ targetUrl, onClose }: { targetUrl: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, onClose)
  const [urlEvents, setUrlEvents] = useState<Array<{
    id: string; timestamp: number; reachable: boolean; blockType: string | null; geohash: string | null; nodeWallet: string
  }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const hostname = useMemo(() => { try { return new URL(targetUrl).hostname } catch { return targetUrl } }, [targetUrl])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    function poll(initial: boolean) {
      if (initial) { setLoading(true); setError(null) }
      fetch(`/api/probe-events?targetUrl=${encodeURIComponent(targetUrl)}&includeStats=false`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
          if (cancelled) return
          const arr = Array.isArray(data) ? data : []
          setUrlEvents(arr.sort((a: { timestamp: number }, b: { timestamp: number }) => b.timestamp - a.timestamp))
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          if (initial) setError('Failed to load history')
          setLoading(false)
        })
    }

    poll(true)
    timer = setInterval(() => poll(false), 30_000)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [targetUrl])

  const upPct = useMemo(() => {
    if (urlEvents.length === 0) return null
    const up = urlEvents.filter(e => e.reachable).length
    return Math.round((up / urlEvents.length) * 100)
  }, [urlEvents])

  const chartBuckets = useMemo(() => {
    const BUCKETS = 48
    const windowMs = 24 * 3600 * 1000
    const now = Date.now()
    const up = new Array<number>(BUCKETS).fill(0)
    const total = new Array<number>(BUCKETS).fill(0)
    for (const e of urlEvents) {
      const age = now - e.timestamp
      if (age < 0 || age > windowMs) continue
      const idx = Math.min(BUCKETS - 1, Math.floor(((windowMs - age) / windowMs) * BUCKETS))
      total[idx]++
      if (e.reachable) up[idx]++
    }
    return total.map((t, i) => ({ pct: t === 0 ? null : up[i] / t, count: total[i] }))
  }, [urlEvents])

  const nonNull = chartBuckets.filter(b => b.pct !== null)
  const avgPct = nonNull.length > 0 ? nonNull.reduce((s, b) => s + (b.pct as number), 0) / nonNull.length : null
  const strokeColor = avgPct === null ? '#aaa' : avgPct >= 0.8 ? '#19b955' : avgPct >= 0.5 ? '#f3ad24' : '#e83341'
  const uptimeColor = upPct === null ? '#aaa' : upPct >= 80 ? '#19b955' : upPct >= 50 ? '#f3ad24' : '#e83341'

  const SVG_W = 300, SVG_H = 80, BUCKETS = 48
  const points = chartBuckets.map((b, i) => ({
    x: (i / (BUCKETS - 1)) * SVG_W,
    y: b.pct === null ? SVG_H : (1 - b.pct) * SVG_H,
  }))
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = linePath + ` L${SVG_W},${SVG_H} L0,${SVG_H} Z`

  return (
    <div
      className="sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="url-health-title"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="sheet"
        style={{ maxHeight: '72vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Sticky header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 16px', flexShrink: 0, borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: uptimeColor + '22',
              display: 'grid', placeItems: 'center',
              color: uptimeColor, flexShrink: 0,
            }}>
              <Activity size={18} />
            </div>
            <div>
              <div id="url-health-title" style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-.3px' }}>{hostname}</div>
              <div style={{ color: '#888', fontSize: 12, marginTop: 1 }}>24-hour availability</div>
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: '50%', background: '#f5f5f5', display: 'grid', placeItems: 'center', color: '#555', flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 32px' }}>

        {/* ── Uptime hero number ── */}
        <div style={{ padding: '24px 20px 0', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ lineHeight: 1 }}>
            <span style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-2px', color: uptimeColor }}>
              {upPct !== null ? `${upPct}%` : '—'}
            </span>
            <span style={{ fontSize: 14, color: '#888', marginLeft: 8 }}>reachable</span>
          </div>
          <div style={{ marginBottom: 6, marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#222' }}>{urlEvents.length}</div>
            <div style={{ fontSize: 11, color: '#888' }}>probe{urlEvents.length !== 1 ? 's' : ''}</div>
          </div>
        </div>

        {/* ── Area chart ── */}
        <div style={{ padding: '16px 20px 0' }}>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            width="100%"
            height="80"
            preserveAspectRatio="none"
            style={{ display: 'block', borderRadius: 8 }}
          >
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.03" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#areaGrad)" />
            <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#aaa', fontSize: 11, marginTop: 5 }}>
            <span>24h ago</span><span>Now</span>
          </div>
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: '#ededed', margin: '20px 0 0' }} />

        {/* ── Probe history ── */}
        <div style={{ padding: '4px 20px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.6px', textTransform: 'uppercase', padding: '14px 0 6px' }}>
            Probe log
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: '#888' }}>
              <div className="skeleton" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: '55%', marginBottom: 6 }} />
                <div className="skeleton" style={{ width: '30%', height: 10 }} />
              </div>
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 0', color: '#e83341' }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 14 }}>{error}</span>
            </div>
          )}

          {!loading && !error && urlEvents.length === 0 && (
            <div style={{ textAlign: 'center', padding: '28px 0', color: '#aaa' }}>
              <Clock size={28} style={{ marginBottom: 8, opacity: .5 }} />
              <div style={{ fontSize: 14 }}>No probes yet</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Check back after the next probe cycle</div>
            </div>
          )}

          {!loading && urlEvents.slice(0, 40).map(e => {
            const isUp = e.reachable
            const isBlock = !isUp && !!e.blockType
            const dotColor = isUp ? '#19b955' : isBlock ? '#e83341' : '#f3ad24'
            const label = isUp ? 'Reachable' : (e.blockType?.replace(/_/g, ' ') ?? 'Unreachable')
            const badgeBg = isUp ? '#eaf8ee' : isBlock ? '#fef2f2' : '#fffbeb'
            const badgeColor = isUp ? '#19b955' : isBlock ? '#e83341' : '#c97c00'
            return (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '13px 0', borderBottom: '1px solid #f2f2f2',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: dotColor + '18',
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  {isUp
                    ? <CheckCircle2 size={16} color={dotColor} />
                    : <XCircle size={16} color={dotColor} />
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      background: badgeBg, color: badgeColor,
                      borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 600,
                    }}>{label}</span>
                    {e.geohash && (
                      <span style={{ color: '#999', fontSize: 11 }}>
                        <MapPin size={10} style={{ display: 'inline', marginRight: 2, verticalAlign: 'middle' }} />
                        {e.geohash.slice(0, 5)}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>{e.nodeWallet?.slice(0, 8)}…{e.nodeWallet?.slice(-4)}</div>
                </div>
                <div style={{ fontSize: 12, color: '#999', whiteSpace: 'nowrap', flexShrink: 0 }}>{timeAgoShort(e.timestamp)}</div>
              </div>
            )
          })}
        </div>
        </div>{/* end scrollable body */}
      </div>
    </div>
  )
}

// ─── Network tab ───────────────────────────────────────────────────────────────

function useMonitoredTargets() {
  const [targets, setTargets] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/targets')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.targets) setTargets(d.targets) })
      .catch(() => {})
  }, [])
  return targets
}

function NetworkPage({ events, stats, loading, error, onRetry, onOpenUrlHealth }: {
  events: ReturnType<typeof useBlockEvents>['events']
  stats: ReturnType<typeof useBlockEvents>['stats']
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenUrlHealth: (url: string) => void
}) {
  const monitoredTargets = useMonitoredTargets()

  const affectedDomains = useMemo(() => {
    const hostMap = new Map<string, { count: number; url: string }>()
    for (const e of events) {
      if (!e.reachable) {
        try {
          const host = new URL(e.targetUrl).hostname
          const existing = hostMap.get(host)
          hostMap.set(host, { count: (existing?.count ?? 0) + 1, url: e.targetUrl })
        } catch { /* skip */ }
      }
    }
    return [...hostMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5)
  }, [events])

  const healthStats = useMemo(() => [
    ['Active nodes', stats?.liveProbes?.toLocaleString() ?? '—', 'green'],
    ['Regions monitored', stats?.regions?.toLocaleString() ?? '—', ''],
    ['Confirmed incidents', stats?.blocksToday?.toLocaleString() ?? '—', stats?.blocksToday ? 'red' : ''],
    ['Volunteer proxies', stats?.volunteerCount?.toLocaleString() ?? '—', ''],
  ], [stats])

  return (
    <>
      <div className="page-title">
        <h1>Network</h1>
        <StatusLine />
      </div>
      <section aria-label="Live network globe and node count">
      <DottedGlobe compact />
      <div className="big-stat" aria-busy={loading} aria-label={loading ? 'Loading node count' : undefined}>
        <strong>
          {loading
            ? <span className="skeleton" style={{ height: 35, width: 80, display: 'inline-block', borderRadius: 6 }} />
            : (stats?.liveProbes ?? 0).toLocaleString()}
        </strong>
        {loading
          ? <span className="skeleton" style={{ height: 16, width: 140, display: 'inline-block', borderRadius: 4 }} />
          : <span>Online volunteer nodes</span>}
        {loading
          ? <small><span className="skeleton" style={{ height: 14, width: 160, display: 'inline-block', borderRadius: 4 }} /></small>
          : <small>Across {(stats?.regions ?? 0).toLocaleString()} regions worldwide</small>}
      </div>
      </section>
      <div className="divider" />
      <section className="section-block">
        <h2>Network health</h2>
        {healthStats.map(([label, value, color]) => (
          <div className="health-row" key={label}>
            <span>{label}</span>
            <b className={color}>{value}</b>
          </div>
        ))}
      </section>
      <section className="section-block">
        <h2>Most affected services</h2>
        {affectedDomains.length > 0 ? affectedDomains.map(([domain, { count, url }]) => (
          <button
            key={domain}
            className="service-row"
            onClick={() => onOpenUrlHealth(url)}
            aria-label={`View health history for ${domain}`}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <span className="service-icon"><Globe2 size={19} aria-hidden="true" /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{domain}</b>
              <small>{count} report{count !== 1 ? 's' : ''} of interference</small>
            </div>
            <ChevronRight size={16} style={{ color: '#555', flexShrink: 0 }} aria-hidden="true" />
          </button>
        )) : (
          <p style={{ color: '#666', margin: '12px 0' }}>No interference detected in the last 48 hours</p>
        )}
      </section>
      {monitoredTargets.length > 0 && (
        <section className="section-block">
          <h2>Monitored sites</h2>
          {monitoredTargets.map(url => {
            let hostname = url
            try { hostname = new URL(url).hostname } catch { /* ok */ }
            const eventCount = events.filter(e => e.targetUrl === url || (() => { try { return new URL(e.targetUrl).hostname === hostname } catch { return false } })()).length
            const reachableCount = events.filter(e => {
              let match = false
              try { match = new URL(e.targetUrl).hostname === hostname } catch { /* ok */ }
              return match && e.reachable
            }).length
            const upPct = eventCount > 0 ? Math.round(reachableCount / eventCount * 100) : null
            return (
              <button
                key={url}
                className="service-row"
                onClick={() => onOpenUrlHealth(url)}
                aria-label={`View availability history for ${hostname}`}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <span className="service-icon"><Globe2 size={19} aria-hidden="true" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{hostname}</b>
                  <small style={{ color: upPct === null ? '#555' : upPct >= 80 ? '#19b955' : upPct >= 50 ? '#f3ad24' : '#e83341' }}>
                    {upPct === null ? 'No data yet' : `${upPct}% reachable`}
                  </small>
                </div>
                <ChevronRight size={16} style={{ color: '#555', flexShrink: 0 }} aria-hidden="true" />
              </button>
            )
          })}
        </section>
      )}
      {!loading && error ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>
          Could not load events —{' '}
          <button onClick={onRetry} style={{ color: 'inherit', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            tap to retry
          </button>
        </div>
      ) : !loading && events.length === 0 && (
        <div style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>
          No network events recorded yet
        </div>
      )}
    </>
  )
}

// ─── Connect tab ───────────────────────────────────────────────────────────────

const ROUTES = [
  { label: 'Best available route', region: 'auto', description: 'Auto-selects the fastest node' },
  { label: 'Europe', region: 'eu', description: 'Exit via EU volunteer node' },
  { label: 'North America', region: 'na', description: 'Exit via NA volunteer node' },
  { label: 'Asia Pacific', region: 'apac', description: 'Exit via APAC volunteer node' },
]

function ConnectPage({ onConnect, connected, onDisconnect, events, walletAddr, rpcUrl }: {
  onConnect: () => void
  connected: boolean
  onDisconnect: () => void
  events: { timestamp: number }[]
  walletAddr: string
  rpcUrl: string
}) {
  const [routeIdx, setRouteIdx] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [cmdCopied, setCmdCopied] = useState(false)
  const cmdCopyRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const route = ROUTES[routeIdx]

  const proxyCommand = useMemo(() => {
    const wallet = walletAddr || '<your-wallet-address>'
    const geohash = 'u1hxr'
    return `npx tsx packages/proxy-client/src/cli.ts volunteer \\\n  --wallet=${wallet} \\\n  --geohash=${geohash}${route.region !== 'auto' ? ` \\\n  --region=${route.region}` : ''}`
  }, [walletAddr, route.region])

  const copyCmd = useCallback(() => {
    navigator.clipboard?.writeText(proxyCommand.replace(/\\\n\s+/g, ' '))
    setCmdCopied(true)
    if (cmdCopyRef.current) clearTimeout(cmdCopyRef.current)
    cmdCopyRef.current = setTimeout(() => setCmdCopied(false), 2000)
  }, [proxyCommand])
  useEffect(() => () => { if (cmdCopyRef.current) clearTimeout(cmdCopyRef.current) }, [])

  const healthRows = useMemo<[string, string][]>(() => [
    ['Volunteer node', route.label],
    ['Approximate exit', route.description],
    ['Proxy address', '127.0.0.1:8080'],
    ['Traffic routing mode', 'HTTP proxy (npx)'],
  ], [route])

  return (
    <>
      <div className="page-title">
        <h1>Connect</h1>
        <StatusLine>{connected ? `Connected via ${route.label}` : 'Ready to connect'}</StatusLine>
      </div>
      <div className={`connect-card${connected ? ' connected' : ''}`}>
        <div className="shield"><Shield size={42} strokeWidth={1.5} aria-hidden="true" /></div>
        <strong>{connected ? 'Connected' : 'Disconnected'}</strong>
        <span>{connected ? route.label : 'Choose a route to protect your traffic'}</span>
      </div>
      <button className="route-select" aria-label={`Select route: ${route.label}`} onClick={() => setPickerOpen(true)}>
        <div>
          <small>Exit region</small>
          <b>{route.label}</b>
          <span>{route.description}</span>
        </div>
        <ChevronDown aria-hidden="true" />
      </button>
      {pickerOpen && (
        <div className="sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="route-picker-title" onClick={() => setPickerOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <span id="route-picker-title">Select exit region</span>
              <button aria-label="Close" onClick={() => setPickerOpen(false)}><X size={18} /></button>
            </div>
            {ROUTES.map((r, i) => (
              <button key={r.label} className={`sheet-item${i === routeIdx ? ' selected' : ''}`} onClick={() => { setRouteIdx(i); setPickerOpen(false) }}>
                <div>
                  <b>{r.label}</b>
                  <span>{r.description}</span>
                </div>
                {i === routeIdx && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
      <MiniChart events={events} />
      <div className="range-row"><span className="range-label">Last hour</span></div>
      <button className="primary-button" onClick={connected ? onDisconnect : onConnect}>{connected ? 'Disconnect' : 'Connect'}</button>
      <div className="quick-actions">
        <button aria-label="Select exit region" onClick={() => setPickerOpen(true)}><Globe2 aria-hidden="true" /><span>Choose region</span></button>
        <button aria-label="Auto-select best available route" onClick={() => setRouteIdx(0)}><Zap aria-hidden="true" /><span>Best route</span></button>
      </div>

      {/* ── How to connect ── */}
      <section className="section-block" style={{ marginTop: 8 }}>
        <h2>How to connect</h2>
        <p style={{ color: '#666', fontSize: 13, marginBottom: 12 }}>
          Run this command on the machine you want to route traffic from. It starts a local HTTP proxy on <code>127.0.0.1:8080</code>.
        </p>
        <div style={{
          background: '#1a1a2e', color: '#e8f5e9', borderRadius: 10,
          padding: '12px 14px', fontSize: 12, fontFamily: 'monospace',
          lineHeight: 1.7, position: 'relative', overflowX: 'auto',
        }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{proxyCommand}</pre>
          <button
            onClick={copyCmd}
            aria-label="Copy proxy command"
            style={{
              position: 'absolute', top: 8, right: 8, background: cmdCopied ? '#19b955' : 'rgba(255,255,255,0.1)',
              border: 'none', borderRadius: 6, padding: '4px 10px', color: '#fff',
              cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {cmdCopied ? <><Check size={12} aria-hidden="true" /> Copied!</> : <><Copy size={12} aria-hidden="true" /> Copy</>}
          </button>
        </div>
        <p style={{ color: '#888', fontSize: 12, marginTop: 10 }}>
          After starting, set your browser proxy to <b>127.0.0.1:8080</b>. Chrome: Settings → System → Proxy settings.
        </p>
      </section>

      {connected && (
        <section className="section-block">
          <h2>Route details</h2>
          {healthRows.map(([a, b]) => (
            <div className="health-row" key={a}>
              <span>{a}</span>
              <b>{b}</b>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

// ─── Activity tab ──────────────────────────────────────────────────────────────

function ActivityPage({ events, loading, error, onRetry, onOpenUrlHealth }: {
  events: ReturnType<typeof useBlockEvents>['events']
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenUrlHealth: (url: string) => void
}) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDeferredValue(search)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [visibleCount, setVisibleCount] = useState(50)

  const eventsWithHostname = useMemo(() => events.map(e => {
    let hostname = e.targetUrl
    try { hostname = new URL(e.targetUrl).hostname } catch { /* ok */ }
    return { ...e, hostname }
  }), [events])

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    const list = q
      ? eventsWithHostname.filter(e => e.hostname.includes(q) || e.geohash?.slice(0, 4).toLowerCase().includes(q) || e.blockType?.toLowerCase().includes(q))
      : eventsWithHostname
    return [...list]
      .sort((a, b) => sort === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp)
  }, [eventsWithHostname, debouncedSearch, sort])

  useEffect(() => { setVisibleCount(50) }, [debouncedSearch, sort])

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  return (
    <>
      <div className="page-title">
        <h1>Activity</h1>
        <StatusLine>All activity</StatusLine>
      </div>
      <div className={`input-field${search ? ' active' : ''}`}>
        <Search size={20} aria-hidden="true" />
        <input
          placeholder="Search domains, regions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search events"
        />
      </div>
      <div className="filter-row">
        <button
          className={`filter ${sort === 'newest' ? 'active' : ''}`}
          onClick={() => setSort('newest')}
          aria-pressed={sort === 'newest'}
        >
          Newest first <ChevronDown size={14} />
        </button>
        <button
          className={`filter ${sort === 'oldest' ? 'active' : ''}`}
          onClick={() => setSort('oldest')}
          aria-pressed={sort === 'oldest'}
        >
          Oldest first <ChevronDown size={14} />
        </button>
      </div>

      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
        {!loading && debouncedSearch === search ? (filtered.length === 0 ? (search ? 'No events match this search' : '') : `${filtered.length} result${filtered.length === 1 ? '' : 's'} found`) : ''}
      </div>

      {loading && filtered.length === 0 ? (
        <div aria-busy="true" aria-label="Loading events">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="activity-row">
              <span className="event-icon" />
              <div>
                <span className="skeleton" style={{ width: 140, height: 14, display: 'block', borderRadius: 6 }} />
                <small className="skeleton" style={{ width: 100, height: 12, display: 'block', marginTop: 6, borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '40px 0' }}>
          {error && !search ? (
            <>Could not load events —{' '}
              <button onClick={onRetry} style={{ color: 'inherit', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
                tap to retry
              </button>
            </>
          ) : search ? 'No events match this search' : 'No events yet'}
        </div>
      ) : (
        <>
          {visibleCount < filtered.length && (
            <div style={{ color: '#666', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
              Showing {visibleCount} of {filtered.length} events
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, opacity: search !== debouncedSearch ? 0.5 : 1, transition: 'opacity 0.15s' }} aria-label="Censorship events" aria-busy={search !== debouncedSearch}>
            {visible.map(event => {
              const color = statusColor(event.blockType, event.reachable)
              const label = statusLabel(event.blockType, event.reachable)
              return (
                <li key={event.id} className="activity-row" style={{ cursor: 'pointer' }} onClick={() => onOpenUrlHealth(event.targetUrl)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenUrlHealth(event.targetUrl) } }} aria-label={`View health history for ${event.hostname}`}>
                  <span className={`event-icon ${color === 'green' ? 'reachable' : color === 'amber' ? 'warning' : 'blocked'}`}>
                    {event.reachable ? <Shield size={19} aria-hidden="true" /> : <Zap size={19} aria-hidden="true" />}
                  </span>
                  <div>
                    <b>{label} detected</b>
                    <span>
                      {event.hostname}
                      {event.geohash ? ` · ${event.geohash.slice(0, 4)}` : ''}
                    </span>
                    <small>{timeAgo(event.timestamp)}</small>
                  </div>
                  <strong className={color}>{label}</strong>
                </li>
              )
            })}
          </ul>
          {visibleCount < filtered.length && (
            <button
              className="filter"
              style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
              onClick={() => setVisibleCount(c => c + 50)}
            >
              Load more ({filtered.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}
    </>
  )
}

// ─── More tab ──────────────────────────────────────────────────────────────────

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [tab, setTab] = useState<Tab>('radar')
  const [testOpen, setTestOpen] = useState(false)
  const [testInitialUrl, setTestInitialUrl] = useState<string | undefined>()
  const [walletOpen, setWalletOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const [urlHealthTarget, setUrlHealthTarget] = useState<string | null>(null)
  const { authenticated, user } = usePrivy()
  const walletAddr = user?.wallet?.address ?? ''
  const rpcUrl = process.env['NEXT_PUBLIC_ARKIV_RPC_URL'] ?? ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const prevTab = useRef<Tab>('radar')

  useEffect(() => {
    if (prevTab.current === tab) return
    prevTab.current = tab
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [tab])

  const openUrlHealth = useCallback((url: string) => setUrlHealthTarget(url), [])
  const closeUrlHealth = useCallback(() => setUrlHealthTarget(null), [])

  const modalOpen = testOpen || walletOpen || urlHealthTarget !== null
  useEffect(() => {
    document.body.classList.toggle('modal-open', modalOpen)
    if (scrollRef.current) scrollRef.current.inert = modalOpen
    if (navRef.current) navRef.current.inert = modalOpen
    return () => {
      document.body.classList.remove('modal-open')
      if (scrollRef.current) scrollRef.current.inert = false
      if (navRef.current) navRef.current.inert = false
    }
  }, [modalOpen])

  const { events, stats, loading, error, retry } = useBlockEvents({})

  const liveProbes = stats?.liveProbes ?? 0
  const regions = stats?.regions ?? 0
  const blocksToday = stats?.blocksToday ?? 0

  const openTest = useCallback((url?: string) => { setTestInitialUrl(url); setTestOpen(true) }, [])
  const goConnect = useCallback(() => setTab('connect'), [])
  const goNetwork = useCallback(() => setTab('network'), [])
  const openWallet = useCallback(() => setWalletOpen(true), [])
  const closeWallet = useCallback(() => { setWalletOpen(false) }, [])
  const startConnect = useCallback(() => { setConnected(true) }, [])
  const disconnect = useCallback(() => setConnected(false), [])

  let content: React.ReactNode
  if (tab === 'radar') {
    content = <Radar onTest={() => openTest()} onConnect={goConnect} onViewNetwork={goNetwork} liveProbes={liveProbes} regions={regions} blocksToday={blocksToday} loading={loading} error={error} events={events} />
  } else if (tab === 'network') {
    content = <NetworkPage events={events} stats={stats} loading={loading} error={error} onRetry={retry} onOpenUrlHealth={openUrlHealth} />
  } else if (tab === 'connect') {
    content = <ConnectPage
      connected={connected}
      onConnect={startConnect}
      onDisconnect={disconnect}
      events={events}
      walletAddr={walletAddr}
      rpcUrl={rpcUrl}
    />
  } else if (tab === 'activity') {
    content = <ActivityPage events={events} loading={loading} error={error} onRetry={retry} onOpenUrlHealth={openUrlHealth} />
  }

  return (
    <main className="app-shell">
      <div className="phone">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-white focus:text-black">Skip to main content</a>
        <Header onAvatarClick={openWallet} />

        {error && (
          <div
            role="alert"
            style={{
              margin: '0 40px',
              padding: '12px 16px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: 12,
              fontSize: 13,
              color: '#856404',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>⚠ Network error: {error}</span>
            <button
              onClick={retry}
              style={{
                background: 'none',
                border: '1px solid #856404',
                borderRadius: 6,
                color: '#856404',
                cursor: 'pointer',
                fontSize: 12,
                padding: '2px 8px',
                flexShrink: 0,
              }}
              aria-label="Retry loading events"
            >
              Retry
            </button>
          </div>
        )}

        <div ref={scrollRef} className="scroll-content" id="main-content" tabIndex={-1}>
          {content}
        </div>

        <nav ref={navRef} className="bottom-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              aria-label={label}
            >
              <Icon size={23} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {testOpen && <TestUrlModal onClose={() => { setTestOpen(false); setTestInitialUrl(undefined) }} initialUrl={testInitialUrl} />}
        {walletOpen && <WalletSheet onClose={closeWallet} />}
        {urlHealthTarget && <UrlHealthDrawer targetUrl={urlHealthTarget} onClose={closeUrlHealth} />}
      </div>
    </main>
  )
}
