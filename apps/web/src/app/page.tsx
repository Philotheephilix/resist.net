'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, useCallback, useRef, useEffect, useDeferredValue, memo } from 'react'
import {
  Activity,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Globe2,
  Grid2X2,
  Home,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  Network,
  Search,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  Wallet,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { usePrivy } from '../hooks/usePrivyCompat'
import { useBlockEvents } from '../hooks/useBlockEvents'
import type { TestUrlResult } from './api/test-url/route'

const Globe = dynamic(() => import('react-globe.gl'), { ssr: false, loading: () => <div role="status" aria-label="Loading globe" style={{width:295,height:295,display:'flex',alignItems:'center',justifyContent:'center'}}><Loader2 size={32} style={{ animation: 'spin 1s linear infinite' }} /></div> })

const POLY_CAP_COLOR = () => 'rgba(28, 31, 34, 0.92)'
const POLY_SIDE_COLOR = () => 'rgba(18, 20, 22, 0.45)'
const POLY_STROKE_COLOR = () => 'rgba(255,255,255,0.18)'
const ARC_COLOR = () => ['#19c35c', '#87e8a8']

type Tab = 'radar' | 'network' | 'connect' | 'activity' | 'more'

const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'radar', label: 'Radar', icon: Home },
  { id: 'network', label: 'Network', icon: Activity },
  { id: 'connect', label: 'Connect', icon: TrendingUp },
  { id: 'activity', label: 'Activity', icon: Clock3 },
  { id: 'more', label: 'More', icon: Grid2X2 },
]

const DEFAULT_ARCS = [
  { startLat: 19.07, startLng: 72.87, endLat: 51.5, endLng: -0.12 },
  { startLat: 19.07, startLng: 72.87, endLat: 40.71, endLng: -74 },
  { startLat: -6.2, startLng: 106.8, endLat: 19.07, endLng: 72.87 },
]

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
      <button className="icon-button" aria-label="Notifications" onClick={() => alert('Notifications coming soon')}><Bell size={21} strokeWidth={1.8} /></button>
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

function DottedGlobe({ compact = false, points }: {
  compact?: boolean
  points?: Array<{ lat: number; lng: number; size: number; color: string }>
}) {
  const [autoRotate, setAutoRotate] = useState(true)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [countryFeatures, setCountryFeatures] = useState<unknown[]>([])
  useEffect(() => {
    const el = wrapRef.current
    if (el) el.style.willChange = autoRotate ? 'transform' : 'auto'
  }, [autoRotate])
  useEffect(() => {
    Promise.all([
      import('topojson-client'),
      import('world-atlas/countries-110m.json'),
    ]).then(([{ feature }, countries]) => {
      setCountryFeatures((feature as (t: unknown, o: unknown) => { features: unknown[] })(countries, (countries as { objects: { countries: unknown } }).objects.countries).features)
    })
  }, [])
  const displayPoints = points ?? DEFAULT_POINTS

  return (
    <div
      ref={wrapRef}
      className={`globe-wrap ${compact ? 'compact' : ''}`}
      aria-label="Interactive live network globe. Drag to rotate and use touch pinch to zoom."
      onPointerDown={() => { if (wrapRef.current) wrapRef.current.style.willChange = 'transform' }}
      onPointerUp={() => { if (wrapRef.current && !autoRotate) wrapRef.current.style.willChange = 'auto' }}
    >
      <Globe
        width={295}
        height={295}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/resistnet-world-globe.png"
        polygonsData={countryFeatures}
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
        arcsData={DEFAULT_ARCS}
        arcColor={ARC_COLOR}
        arcAltitude={0.18}
        arcStroke={0.45}
        arcDashLength={0.35}
        arcDashGap={1.1}
        arcDashAnimateTime={1600}
        enablePointerInteraction
        animateIn
        controlsOptions={{
          enableDamping: true,
          dampingFactor: 0.08,
          autoRotate,
          autoRotateSpeed: 0.35,
          minDistance: 185,
          maxDistance: 430,
        }}
        onGlobeClick={() => setAutoRotate(false)}
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
      aria-label={hasData ? 'Network activity chart (last hour)' : 'Network activity chart (no data yet)'}
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
  }, [panelRef])
}

// ─── Test URL modal ────────────────────────────────────────────────────────────

type TestMethod = 'HTTP' | 'DNS' | 'TCP'

function TestUrlModal({ onClose }: { onClose: () => void }) {
  const [urlInput, setUrlInput] = useState('')
  const [method, setMethod] = useState<TestMethod>('HTTP')
  const [region, setRegion] = useState('Auto')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestUrlResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, onClose)

  const runTest = useCallback(async () => {
    const raw = urlInput.trim()
    if (!raw) { inputRef.current?.focus(); return }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch('/api/test-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, region }),
      })
      const data = await res.json()
      if (res.ok || res.status === 501) {
        setResult(data as TestUrlResult)
      } else {
        setError(data.error ?? 'Test failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRunning(false)
    }
  }, [urlInput, method, region])

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-modal-title"
      onClick={onClose}
    >
      <div ref={panelRef} className="test-modal" onClick={e => e.stopPropagation()}>
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

        <div className="route-select compact-select" style={{ position: 'relative' }}>
          <div>
            <small>Region</small>
            <b>{region}</b>
          </div>
          <select
            style={{ position: 'absolute', opacity: 0, inset: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            value={region}
            onChange={e => setRegion(e.target.value)}
            aria-label="Select region"
          >
            <option value="Auto">Auto-select</option>
            <option value="Mumbai, IN">Mumbai, IN</option>
            <option value="Jakarta, ID">Jakarta, ID</option>
            <option value="São Paulo, BR">São Paulo, BR</option>
            <option value="Frankfurt, DE">Frankfurt, DE</option>
            <option value="New York, US">New York, US</option>
          </select>
          <ChevronDown size={18} aria-hidden="true" />
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

        <div className={error ? 'test-result error' : ''} role="alert">
          {error && (
            <>
              <b>Error</b>
              <span>{error}</span>
            </>
          )}
        </div>

        <div className={result ? `test-result ${result.reachable ? 'success' : 'error'}` : ''} role="status">
          {result && (
            <>
              <b>
                {result.notSupported
                  ? 'Not yet supported'
                  : result.reachable
                  ? '✓ Reachable'
                  : `✗ ${statusLabel(result.errorType ?? null, false)}`}
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
            </>
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
    if (ready) return
    const id = setTimeout(() => setPrivyTimedOut(true), 10000)
    return () => clearTimeout(id)
  }, [ready])
  useFocusTrap(panelRef, onClose)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title" onClick={onClose}>
      <div ref={panelRef} className="test-modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close"><X /></button>

        {!ready ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#999' }}>
            {privyTimedOut ? (
              <p style={{ margin: 0, fontSize: 14 }}>Could not connect to authentication service — please try again.</p>
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
            <div style={{ marginTop: 4 }}>
              <input
                readOnly
                value={walletAddr}
                style={{
                  width: '100%', fontSize: 10, fontFamily: 'monospace', color: '#555',
                  background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 6,
                  padding: '4px 6px', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.select()}
                aria-label="Full wallet address"
              />
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
            <p style={{ color: '#aaa', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
              Powered by Privy · Your keys, your control
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Radar tab ─────────────────────────────────────────────────────────────────

function Radar({ onTest, onConnect, onViewNetwork, liveProbes, regions, blocksToday, loading, events }: {
  onTest: () => void
  onConnect: () => void
  onViewNetwork: () => void
  liveProbes: number
  regions: number
  blocksToday: number
  loading: boolean
  events: { timestamp: number }[]
}) {
  return (
    <>
      <section className="hero-block">
        <h1>Network Radar</h1>
        <StatusLine />
        <div className="globe-button">
          <DottedGlobe />
        </div>
        <div className="stats-row">
          <div>
            <strong>
              {loading
                ? <span className="skeleton" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
                : liveProbes.toLocaleString()}
            </strong>
            <span>Online nodes</span>
          </div>
          <div>
            <strong>
              {loading
                ? <span className="skeleton" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
                : blocksToday.toLocaleString()}
            </strong>
            <span>Active incidents</span>
          </div>
          <div>
            <strong>
              {loading
                ? <span className="skeleton" style={{ height: 24, width: 60, display: 'inline-block', borderRadius: 6 }} />
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
        <div className="range-row" style={{ opacity: 0.4 }}>
          <button disabled aria-disabled="true" className="selected" title="Historical view coming soon">1H</button>
          <button disabled aria-disabled="true" title="Historical view coming soon">24H</button>
          <button disabled aria-disabled="true" title="Historical view coming soon">7D</button>
          <button disabled aria-disabled="true" title="Historical view coming soon">30D</button>
        </div>
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
          <span className="pill">Off</span>
        </button>
      </div>
    </>
  )
}

// ─── Network tab ───────────────────────────────────────────────────────────────

function NetworkPage({ events, stats, loading, error, onRetry }: {
  events: ReturnType<typeof useBlockEvents>['events']
  stats: ReturnType<typeof useBlockEvents>['stats']
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const affectedDomains = useMemo(() => {
    const hostCount = new Map<string, number>()
    for (const e of events) {
      if (!e.reachable) {
        try {
          const host = new URL(e.targetUrl).hostname
          hostCount.set(host, (hostCount.get(host) ?? 0) + 1)
        } catch { /* skip */ }
      }
    }
    return [...hostCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
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
      <DottedGlobe compact />
      <div className="big-stat">
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
        {affectedDomains.length > 0 ? affectedDomains.map(([domain, count]) => (
          <div className="service-row" key={domain}>
            <span className="service-icon"><Globe2 size={19} aria-hidden="true" /></span>
            <div>
              <b>{domain}</b>
              <small>{count} report{count !== 1 ? 's' : ''} of interference</small>
            </div>
            <ChevronRight size={17} aria-hidden="true" />
          </div>
        )) : (
          <p style={{ color: '#999', margin: '12px 0' }}>No interference detected in the last 48 hours</p>
        )}
      </section>
      {!loading && error ? (
        <div style={{ color: '#999', textAlign: 'center', padding: '40px 0' }}>
          Could not load events —{' '}
          <button onClick={onRetry} style={{ color: 'inherit', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
            tap to retry
          </button>
        </div>
      ) : !loading && events.length === 0 && (
        <div style={{ color: '#999', textAlign: 'center', padding: '40px 0' }}>
          No network events recorded yet
        </div>
      )}
    </>
  )
}

// ─── Connect tab ───────────────────────────────────────────────────────────────

const ROUTES = [
  { label: 'Best available route', description: 'Auto-selects the fastest node' },
  { label: 'Europe', description: 'Exit via EU volunteer node' },
  { label: 'North America', description: 'Exit via NA volunteer node' },
  { label: 'Asia Pacific', description: 'Exit via APAC volunteer node' },
]

function ConnectPage({ onConnect, connected, onDisconnect }: { onConnect: () => void; connected: boolean; onDisconnect: () => void }) {
  const [routeIdx, setRouteIdx] = useState(0)
  const route = ROUTES[routeIdx]

  function cycleRoute() {
    setRouteIdx((i) => (i + 1) % ROUTES.length)
  }

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
      <button className="route-select" aria-label={`Select route: ${route.label}`} onClick={cycleRoute}>
        <div>
          <small>Exit region</small>
          <b>{route.label}</b>
          <span>{route.description}</span>
        </div>
        <ChevronDown aria-hidden="true" />
      </button>
      <MiniChart />
      <div className="range-row" style={{ opacity: 0.4 }}>
        <button disabled aria-disabled="true" className="selected" title="Historical view coming soon">1H</button>
        <button disabled aria-disabled="true" title="Historical view coming soon">24H</button>
        <button disabled aria-disabled="true" title="Historical view coming soon">7D</button>
        <button disabled aria-disabled="true" title="Historical view coming soon">30D</button>
      </div>
      <button className="primary-button" onClick={connected ? onDisconnect : onConnect}>{connected ? 'Disconnect' : 'Connect'}</button>
      <div className="quick-actions">
        <button onClick={cycleRoute}><Globe2 aria-hidden="true" /><span>Choose region</span></button>
        <button onClick={() => setRouteIdx(0)}><Zap aria-hidden="true" /><span>Find best route</span></button>
        <button onClick={onConnect}><Menu aria-hidden="true" /><span>More options</span></button>
      </div>
      <section className="section-block">
        <h2>Route details</h2>
        {[
          ['Volunteer node', 'Awaiting connection'],
          ['Approximate exit', 'Not selected'],
          ['Latency / packet loss', '—'],
          ['Traffic routing mode', 'Browser extension'],
        ].map(([a, b]) => (
          <div className="health-row" key={a}>
            <span>{a}</span>
            <b>{b}</b>
          </div>
        ))}
      </section>
    </>
  )
}

// ─── Activity tab ──────────────────────────────────────────────────────────────

function ActivityPage({ events, loading, error, onRetry }: {
  events: ReturnType<typeof useBlockEvents>['events']
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDeferredValue(search)
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [visibleCount, setVisibleCount] = useState(50)

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    let list = q
      ? events.filter(e => {
          try { return new URL(e.targetUrl).hostname.includes(q) || e.geohash?.startsWith(q) }
          catch { return false }
        })
      : events
    return [...list]
      .sort((a, b) => sort === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp)
      .map(e => {
        let hostname = e.targetUrl
        try { hostname = new URL(e.targetUrl).hostname } catch { /* ok */ }
        return { ...e, hostname }
      })
  }, [events, debouncedSearch, sort])

  useEffect(() => { setVisibleCount(50) }, [debouncedSearch, sort])

  const visible = filtered.slice(0, visibleCount)

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
        <div style={{ color: '#999', textAlign: 'center', padding: '40px 0' }}>
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
            <div style={{ color: '#999', fontSize: 12, textAlign: 'center', marginBottom: 8 }}>
              Showing {visibleCount} of {filtered.length} events
            </div>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, opacity: search !== debouncedSearch ? 0.5 : 1, transition: 'opacity 0.15s' }} aria-label="Censorship events" aria-busy={search !== debouncedSearch}>
            {visible.map(event => {
              const color = statusColor(event.blockType, event.reachable)
              const label = statusLabel(event.blockType, event.reachable)
              return (
                <li key={event.id} className="activity-row">
                  <span className={`event-icon ${color === 'green' ? 'reachable' : color === 'amber' ? 'warning' : 'blocked'}`}>
                    {event.reachable ? <Shield size={19} aria-hidden="true" /> : <Zap size={19} aria-hidden="true" />}
                  </span>
                  <div>
                    <b>{label} detected</b>
                    <span>
                      <a href={/^https?:\/\//i.test(event.targetUrl) ? event.targetUrl : '#'} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                        {hostname}
                      </a>
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

function MorePage({ onOpenWallet }: { onOpenWallet: () => void }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  const walletAddr = user?.wallet?.address ?? ''
  const [copied, setCopied] = useState(false)
  const [comingSoon, setComingSoon] = useState('')
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])
  useEffect(() => {
    if (!comingSoon) return
    const id = setTimeout(() => setComingSoon(''), 2500)
    return () => clearTimeout(id)
  }, [comingSoon])

  return (
    <>
      <div className="page-title">
        <h1>More</h1>
        <StatusLine>ResistNet</StatusLine>
      </div>

      {/* Profile card */}
      <div
        className="profile-card"
        style={{ cursor: 'pointer' }}
        onClick={onOpenWallet}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onOpenWallet()}
        aria-label={authenticated ? `Wallet: ${truncAddr(walletAddr)}` : 'Sign in with Ethereum'}
      >
        <div
          className="profile large"
          style={{
            background: authenticated && walletAddr ? addrHue(walletAddr) : '#ffe3ee',
            color: authenticated && walletAddr ? addrFg(walletAddr) : '#e65c90',
            fontSize: 18,
          }}
          aria-hidden="true"
        >
          {!ready ? '…' : authenticated && walletAddr ? walletInitials(walletAddr) : 'R'}
        </div>
        <div>
          {authenticated && walletAddr ? (
            <>
              <b>Connected wallet</b>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <span
                  style={{
                    fontFamily: 'monospace', fontSize: 13,
                    color: '#555', letterSpacing: '0.03em',
                  }}
                >
                  {truncAddr(walletAddr)}
                </span>
                <button
                  type="button"
                  aria-label="Copy wallet address"
                  onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(walletAddr); setCopied(true) }}
                  style={{
                    background: 'none', border: 'none', padding: '2px 4px',
                    cursor: 'pointer', color: copied ? '#19b955' : '#888', display: 'flex', alignItems: 'center',
                  }}
                >
                  {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                </button>
              </span>
            </>
          ) : (
            <>
              <b>Not signed in</b>
              <span style={{ color: '#19b955', fontWeight: 600 }}>Sign in with Ethereum →</span>
            </>
          )}
        </div>
        <ChevronRight aria-hidden="true" />
      </div>

      {/* Auth action */}
      {authenticated ? (
        <button
          onClick={() => logout()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 0', borderBottom: '1px solid var(--line)',
            textAlign: 'left', color: '#e24a47',
          }}
          aria-label="Disconnect wallet"
        >
          <span className="setting-icon" style={{ color: '#e24a47' }}>
            <LogOut size={20} aria-hidden="true" />
          </span>
          <span>
            <b>Disconnect wallet</b>
            <small style={{ color: '#e24a47', opacity: 0.7 }}>Sign out of ResistNet</small>
          </span>
        </button>
      ) : (
        <button
          onClick={login}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 0', borderBottom: '1px solid var(--line)',
            textAlign: 'left', color: '#19b955',
          }}
          aria-label="Sign in with Ethereum"
        >
          <span className="setting-icon" style={{ color: '#19b955' }}>
            <LogIn size={20} aria-hidden="true" />
          </span>
          <span>
            <b>Sign in with Ethereum</b>
            <small>Connect your wallet to ResistNet</small>
          </span>
        </button>
      )}

      {comingSoon && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--card, #1a1a2e)', color: 'var(--text, #fff)',
          padding: '10px 20px', borderRadius: 8, fontSize: 14,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)', zIndex: 999, pointerEvents: 'none',
        }}>
          {comingSoon} — coming soon
        </div>
      )}
      <section className="settings-list" aria-label="Settings">
        {[
          ['Monitored services', 'Manage services', Globe2],
          ['My volunteer node', 'Not configured', Network],
          ['Saved regions', 'Manage regions', SlidersHorizontal],
          ['Network diagnostics', 'Run a check', Activity],
          ['Privacy and security', 'Your data, your control', Shield],
        ].map(([title, sub, Icon]) => (
          <button key={title as string} aria-label={title as string}
            onClick={() => setComingSoon(title as string)}
          >
            <span className="setting-icon"><Icon size={20} aria-hidden="true" /></span>
            <span>
              <b>{title as string}</b>
              <small>{sub as string}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ))}
      </section>
      <div className="about">
        ResistNet <span>Protocol v0.1 · Open network observability</span>
      </div>
    </>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [tab, setTab] = useState<Tab>('radar')
  const [testOpen, setTestOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const connectingRef = useRef(false)
  const { authenticated } = usePrivy()
  const scrollRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const isMounted = useRef(false)

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      return
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [tab])

  const modalOpen = testOpen || walletOpen
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

  const openTest = useCallback(() => setTestOpen(true), [])
  const goConnect = useCallback(() => setTab('connect'), [])
  const goNetwork = useCallback(() => setTab('network'), [])
  const openWallet = useCallback(() => setWalletOpen(true), [])
  const startConnect = useCallback(() => { connectingRef.current = true; setWalletOpen(true) }, [])
  const disconnect = useCallback(() => setConnected(false), [])

  let content: React.ReactNode
  if (tab === 'radar') {
    content = <Radar onTest={openTest} onConnect={goConnect} onViewNetwork={goNetwork} liveProbes={liveProbes} regions={regions} blocksToday={blocksToday} loading={loading} events={events} />
  } else if (tab === 'network') {
    content = <NetworkPage events={events} stats={stats} loading={loading} error={error} onRetry={retry} />
  } else if (tab === 'connect') {
    content = <ConnectPage
      connected={connected}
      onConnect={startConnect}
      onDisconnect={disconnect}
    />
  } else if (tab === 'activity') {
    content = <ActivityPage events={events} loading={loading} error={error} onRetry={retry} />
  } else {
    content = <MorePage onOpenWallet={openWallet} />
  }

  return (
    <main className="app-shell">
      <div className="phone">
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

        <div ref={scrollRef} className="scroll-content" id="main-content">
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

        {testOpen && <TestUrlModal onClose={() => setTestOpen(false)} />}
        {walletOpen && <WalletSheet onClose={() => { setWalletOpen(false); if (connectingRef.current) { connectingRef.current = false; if (authenticated) setConnected(true) } }} />}
      </div>
    </main>
  )
}
