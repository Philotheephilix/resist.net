'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, useCallback, useRef } from 'react'
import { feature } from 'topojson-client'
import countries from 'world-atlas/countries-110m.json'
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock3,
  Globe2,
  Grid2X2,
  Home,
  Loader2,
  Menu,
  Network,
  Search,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  Wifi,
  X,
  Zap,
} from 'lucide-react'
import { useBlockEvents } from '../hooks/useBlockEvents'
import type { TestUrlResult } from './api/test-url/route'

const Globe = dynamic(() => import('react-globe.gl'), { ssr: false })

type Tab = 'radar' | 'network' | 'connect' | 'activity' | 'more'

const navItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'radar', label: 'Radar', icon: Home },
  { id: 'network', label: 'Network', icon: Activity },
  { id: 'connect', label: 'Connect', icon: TrendingUp },
  { id: 'activity', label: 'Activity', icon: Clock3 },
  { id: 'more', label: 'More', icon: Grid2X2 },
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

function Header() {
  return (
    <header className="topbar">
      <div className="profile" aria-label="User profile">R</div>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><Network size={16} /></span>
        <span>ResistNet</span>
      </div>
      <button className="icon-button" aria-label="Notifications"><Bell size={21} strokeWidth={1.8} /></button>
    </header>
  )
}

function DottedGlobe({ compact = false, points }: {
  compact?: boolean
  points?: Array<{ lat: number; lng: number; size: number; color: string }>
}) {
  const [autoRotate, setAutoRotate] = useState(true)
  const countryFeatures = useMemo(
    () => feature(countries as never, countries.objects.countries as never).features,
    []
  )
  const displayPoints = points ?? [
    { lat: 19.07, lng: 72.87, size: 0.16, color: '#18b957' },
    { lat: -6.2, lng: 106.8, size: 0.13, color: '#f3ad24' },
    { lat: 40.71, lng: -74, size: 0.13, color: '#18b957' },
    { lat: 51.5, lng: -0.12, size: 0.11, color: '#18b957' },
    { lat: -23.55, lng: -46.63, size: 0.11, color: '#f3ad24' },
  ]

  return (
    <div
      className={`globe-wrap ${compact ? 'compact' : ''}`}
      aria-label="Interactive live network globe. Drag to rotate and use touch pinch to zoom."
    >
      <Globe
        width={295}
        height={295}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/resistnet-world-globe.png"
        polygonsData={countryFeatures}
        polygonGeoJsonGeometry="geometry"
        polygonCapColor={() => 'rgba(28, 31, 34, 0.92)'}
        polygonSideColor={() => 'rgba(18, 20, 22, 0.45)'}
        polygonStrokeColor={() => 'rgba(255,255,255,0.18)'}
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
        arcsData={[
          { startLat: 19.07, startLng: 72.87, endLat: 51.5, endLng: -0.12 },
          { startLat: 19.07, startLng: 72.87, endLat: 40.71, endLng: -74 },
          { startLat: -6.2, startLng: 106.8, endLat: 19.07, endLng: 72.87 },
        ]}
        arcColor={() => ['#19c35c', '#87e8a8']}
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

function MiniChart() {
  return (
    <div className="mini-chart" aria-label="Network activity chart">
      <svg viewBox="0 0 500 108" preserveAspectRatio="none">
        <path d="M0 76 C28 69 35 88 64 75 S95 62 116 74 S145 88 168 72 S197 67 220 79 S245 83 265 65 S284 55 300 63 S312 80 325 42 S342 52 360 35 S388 52 406 31 S428 62 448 48 S470 56 500 24" />
      </svg>
    </div>
  )
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

  const runTest = useCallback(async () => {
    const raw = urlInput.trim()
    if (!raw) { inputRef.current?.focus(); return }
    // Prepend https:// if no protocol given
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
      if (res.ok || res.status === 202) {
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
      aria-label="Test a URL"
      onClick={onClose}
    >
      <div className="test-modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close"><X /></button>
        <h2>Test a URL</h2>
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

        {error && (
          <div className="test-result error" role="alert">
            <b>Error</b>
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className={`test-result ${result.reachable ? 'success' : 'error'}`} role="status">
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
          </div>
        )}

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}

// ─── Radar tab ─────────────────────────────────────────────────────────────────

function Radar({ onTest, liveProbes, regions, blocksToday }: {
  onTest: () => void
  liveProbes: number
  regions: number
  blocksToday: number
}) {
  return (
    <>
      <section className="hero-block">
        <h1>Network Radar</h1>
        <StatusLine />
        <div className="globe-button" role="img" aria-label="Open live network map">
          <DottedGlobe />
        </div>
        <div className="stats-row">
          <div>
            <strong>{liveProbes > 0 ? liveProbes.toLocaleString() : <span className="skeleton" style={{ height: 24, width: 60, display: 'inline-block' }} />}</strong>
            <span>Online nodes</span>
          </div>
          <div>
            <strong>{blocksToday > 0 ? blocksToday.toLocaleString() : '—'}</strong>
            <span>Active incidents</span>
          </div>
          <div>
            <strong>{regions > 0 ? regions.toLocaleString() : '—'}</strong>
            <span>Regions monitored</span>
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>Network activity</h2>
          <button className="more-link">View details <ChevronRight size={16} /></button>
        </div>
        <MiniChart />
        <div className="range-row">
          <span className="selected">1H</span>
          <span>24H</span>
          <span>7D</span>
          <span>30D</span>
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
        <button className="action-card" aria-label="Connect to network (coming soon)">
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

function NetworkPage({ events, stats, loading }: {
  events: ReturnType<typeof useBlockEvents>['events']
  stats: ReturnType<typeof useBlockEvents>['stats']
  loading: boolean
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

  return (
    <>
      <div className="page-title">
        <h1>Network</h1>
        <StatusLine />
      </div>
      <DottedGlobe compact />
      <div className="big-stat">
        <strong>
          {loading ? <span className="skeleton" style={{ height: 35, width: 80, display: 'inline-block' }} /> : (stats?.liveProbes ?? 0).toLocaleString()}
        </strong>
        <span>Online volunteer nodes</span>
        <small>Across {(stats?.regions ?? 0).toLocaleString()} regions worldwide</small>
      </div>
      <div className="divider" />
      <section className="section-block">
        <h2>Network health</h2>
        {[
          ['Active nodes', stats?.liveProbes?.toLocaleString() ?? '—', 'green'],
          ['Regions monitored', stats?.regions?.toLocaleString() ?? '—', ''],
          ['Confirmed incidents', stats?.blocksToday?.toLocaleString() ?? '—', stats?.blocksToday ? 'red' : ''],
          ['Volunteer proxies', stats?.volunteerCount?.toLocaleString() ?? '—', ''],
        ].map(([label, value, color]) => (
          <div className="health-row" key={label}>
            <span>{label}</span>
            <b className={color}>{value}</b>
          </div>
        ))}
      </section>
      {affectedDomains.length > 0 && (
        <section className="section-block">
          <h2>Most affected services</h2>
          {affectedDomains.map(([domain, count]) => (
            <div className="service-row" key={domain}>
              <span className="service-icon"><Globe2 size={19} aria-hidden="true" /></span>
              <div>
                <b>{domain}</b>
                <small>{count} report{count !== 1 ? 's' : ''} of interference</small>
              </div>
              <ChevronRight size={17} aria-hidden="true" />
            </div>
          ))}
        </section>
      )}
    </>
  )
}

// ─── Connect tab ───────────────────────────────────────────────────────────────

function ConnectPage() {
  return (
    <>
      <div className="page-title">
        <h1>Connect</h1>
        <StatusLine>Ready to connect</StatusLine>
      </div>
      <div className="connect-card">
        <div className="shield"><Shield size={42} strokeWidth={1.5} aria-hidden="true" /></div>
        <strong>Disconnected</strong>
        <span>Choose a route to protect your traffic</span>
      </div>
      <div className="route-select">
        <div>
          <small>Exit region</small>
          <b>Best available route</b>
          <span>Auto-selects the fastest node</span>
        </div>
        <ChevronDown aria-hidden="true" />
      </div>
      <MiniChart />
      <div className="range-row">
        <span className="selected">1H</span>
        <span>24H</span>
        <span>7D</span>
        <span>30D</span>
      </div>
      <button className="primary-button">Connect</button>
      <div className="quick-actions">
        <button><Globe2 aria-hidden="true" /><span>Choose region</span></button>
        <button><Zap aria-hidden="true" /><span>Find best route</span></button>
        <button><Menu aria-hidden="true" /><span>More options</span></button>
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

function ActivityPage({ events, loading }: {
  events: ReturnType<typeof useBlockEvents>['events']
  loading: boolean
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = q
      ? events.filter(e => {
          try { return new URL(e.targetUrl).hostname.includes(q) || e.geohash?.startsWith(q) }
          catch { return false }
        })
      : events
    return [...list].sort((a, b) => sort === 'newest' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp).slice(0, 50)
  }, [events, search, sort])

  return (
    <>
      <div className="page-title">
        <h1>Activity</h1>
        <StatusLine>All activity</StatusLine>
      </div>
      <div className="search-box">
        <Search size={20} aria-hidden="true" />
        <input
          style={{ background: 'none', border: 'none', outline: 'none', flex: 1, fontSize: 15, color: '#111' }}
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

      {loading && filtered.length === 0 ? (
        <div aria-busy="true" aria-label="Loading events">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="activity-row">
              <span className="event-icon" />
              <div>
                <span className="skeleton" style={{ width: 140, height: 14, display: 'block' }} />
                <small className="skeleton" style={{ width: 100, height: 12, display: 'block', marginTop: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#999', textAlign: 'center', padding: '40px 0' }}>
          {search ? 'No events match this search' : 'No events yet'}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Censorship events">
          {filtered.map(event => {
            const color = statusColor(event.blockType, event.reachable)
            const label = statusLabel(event.blockType, event.reachable)
            let hostname = event.targetUrl
            try { hostname = new URL(event.targetUrl).hostname } catch { /* ok */ }
            return (
              <li key={event.id} className="activity-row">
                <span className={`event-icon ${color === 'green' ? 'reachable' : color === 'amber' ? 'warning' : 'blocked'}`}>
                  {event.reachable ? <Shield size={19} aria-hidden="true" /> : <Zap size={19} aria-hidden="true" />}
                </span>
                <div>
                  <b>{label} detected</b>
                  <span>
                    <a href={event.targetUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
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
      )}
    </>
  )
}

// ─── More tab ──────────────────────────────────────────────────────────────────

function MorePage() {
  return (
    <>
      <div className="page-title">
        <h1>More</h1>
        <StatusLine>ResistNet</StatusLine>
      </div>
      <div className="profile-card">
        <div className="profile large" aria-hidden="true">R</div>
        <div>
          <b>ResistNet user</b>
          <span>Manage your profile and device</span>
        </div>
        <ChevronRight aria-hidden="true" />
      </div>
      <section className="settings-list" aria-label="Settings">
        {[
          ['Monitored services', '3 services saved', Globe2],
          ['My volunteer node', 'Not configured', Network],
          ['Saved regions', 'Manage regions', SlidersHorizontal],
          ['Network diagnostics', 'Run a check', Activity],
          ['Privacy and security', 'Your data, your control', Shield],
        ].map(([title, sub, Icon]) => (
          <button key={title as string} aria-label={title as string}>
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

  const { events, stats, loading, error } = useBlockEvents({})

  const liveProbes = stats?.liveProbes ?? 0
  const regions = stats?.regions ?? 0
  const blocksToday = stats?.blocksToday ?? 0

  let content: React.ReactNode
  if (tab === 'radar') {
    content = <Radar onTest={() => setTestOpen(true)} liveProbes={liveProbes} regions={regions} blocksToday={blocksToday} />
  } else if (tab === 'network') {
    content = <NetworkPage events={events} stats={stats} loading={loading} />
  } else if (tab === 'connect') {
    content = <ConnectPage />
  } else if (tab === 'activity') {
    content = <ActivityPage events={events} loading={loading} />
  } else {
    content = <MorePage />
  }

  return (
    <main className="app-shell">
      <div className="phone">
        <Header />

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
            }}
          >
            ⚠ Network error: {error}
          </div>
        )}

        <div className="scroll-content" id="main-content">
          {content}
        </div>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              aria-label={label}
            >
              <Icon size={23} strokeWidth={tab === id ? 2.5 : 1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {testOpen && <TestUrlModal onClose={() => setTestOpen(false)} />}
      </div>
    </main>
  )
}
