'use client'

import { useEffect, useRef } from 'react'
import { geohashToLatLng, blockTypeLabel, markerColorForBlockType } from '@resist/map-ui'
import type { ProbeResultRow } from './BlockEventList'

const GEO_CACHE_MAX = 1000

// Module-level geohash→LatLng cache — decode is O(N) bit-interleaving; cache
// avoids repeating it for events that share the same geohash cell (common in
// country-level censorship data where many events map to the same 4-char cell).
const geohashCache = new Map<string, [number, number]>()

// Module-level timestamp cache — event.timestamp is immutable, so formatted strings
// never go stale. Avoids re-allocating Date objects on every renderMarkers call.
const TS_CACHE_MAX = 1000
const tsLocaleMapCache = new Map<number, string>()
function cachedMapTs(ts: number): string {
  let s = tsLocaleMapCache.get(ts)
  if (s === undefined) {
    s = new Date(ts).toLocaleString()
    if (tsLocaleMapCache.size >= TS_CACHE_MAX) tsLocaleMapCache.delete(tsLocaleMapCache.keys().next().value!)
    tsLocaleMapCache.set(ts, s)
  }
  return s
}
function cachedGeohashToLatLng(hash: string): [number, number] {
  let latlng = geohashCache.get(hash)
  if (!latlng) {
    latlng = geohashToLatLng(hash) as [number, number]
    if (geohashCache.size >= GEO_CACHE_MAX) geohashCache.delete(geohashCache.keys().next().value!)
    geohashCache.set(hash, latlng)
  }
  return latlng
}

// HTML-escape for injecting user-controlled strings into popup innerHTML
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Stadia Alidade Smooth Dark — no API key required for open source / non-commercial projects
const TILE_URL =
  'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Resolved token values for Leaflet canvas — CSS variables cannot be used in canvas.
// These MUST match design-system/tokens.css.
const TOKEN_WARNING_600 = '#ffae00'
const TOKEN_ERROR_600 = '#f2280d'
const TOKEN_SUCCESS_600 = '#00c230'

const COLOR_MAP = { warning: TOKEN_WARNING_600, error: TOKEN_ERROR_600, success: TOKEN_SUCCESS_600 }

// Popup badge tokens — opaque bg + dark text to meet WCAG AA 4.5:1 at 11px/600
const BADGE_TOKENS: Record<string, { bg: string; color: string }> = {
  warning: { bg: '#fff6e6', color: '#996800' },  // warning-100 / warning-800 — 7.8:1
  error:   { bg: '#fee9e7', color: '#c2200a' },  // error-100 / error-700 — 5.1:1
  success: { bg: '#e6f9ec', color: '#00741d' },  // success-100 / success-800 — 6.2:1
}

function markerColor(blockType: string | null): string {
  return COLOR_MAP[markerColorForBlockType(blockType)] ?? TOKEN_SUCCESS_600
}

interface CensorshipMapProps {
  events: ProbeResultRow[]
  sidebarOpen?: boolean
}

export default function CensorshipMap({ events, sidebarOpen = true }: CensorshipMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const markerGenRef = useRef(0)
  // lastFocusedMarkerElRef: the SVG element that opened the current popup.
  // Used to return keyboard focus to the marker when the popup closes via Escape.
  const lastFocusedMarkerElRef = useRef<HTMLElement | null>(null)
  // focusTimeoutRef: handle for the deferred popup-focus setTimeout so it can
  // be cancelled if the popup closes before the 50ms fires.
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Separate live regions for two independent announcement streams:
  // - liveRegionRef: popup open/close details (updated by popupopen/popupclose handlers)
  // - filterLiveRef: empty-map state after filter changes (updated by effect)
  // Using one shared region causes popup announcements to be overwritten by the
  // count-change effect during background polls.
  const liveRegionRef = useRef<HTMLDivElement>(null)
  const filterLiveRef = useRef<HTMLDivElement>(null)
  // hasEverHadEventsRef: true once events.length > 0 for the first time.
  // Used to suppress the "no events" announcement on initial load (before any data
  // arrives) — we only announce when a filter change resets a previously non-empty map.
  const hasEverHadEventsRef = useRef(false)
  // Keep a ref to the latest events so the init effect can apply them after
  // async Leaflet init completes, even if events arrived before init finished.
  const pendingEventsRef = useRef<ProbeResultRow[]>(events)
  pendingEventsRef.current = events
  // leafletRef caches the leaflet module after the first async import so subsequent
  // events-change effects don't re-import on every render.
  const leafletRef = useRef<any>(null)
  // markerMapRef: eventId → Leaflet marker. Enables incremental diffing so each
  // poll cycle only adds new markers and removes gone ones — not a full O(N) teardown.
  const markerMapRef = useRef<Map<string, any>>(new Map())
  // mapPopupTimeoutRef: handle for the map-level popupopen setTimeout so it can be
  // cancelled when another popup opens before the 60ms fires, preventing listener
  // accumulation on the same popup div across rapid opens.
  const mapPopupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Create a single marker DOM element and bind events. Extracted so it can be called
  // for both incremental adds (new event IDs) and full re-init.
  const createMarker = (leaflet: any, event: ProbeResultRow) => {
      const [lat, lng] = cachedGeohashToLatLng(event.geohash)
      const badgeVariant = markerColorForBlockType(event.blockType)
      const color = COLOR_MAP[badgeVariant] ?? TOKEN_SUCCESS_600
      const label = blockTypeLabel(event.blockType)
      const ts = cachedMapTs(event.timestamp)
      const wallet = event.nodeWallet.length > 10
        ? `${event.nodeWallet.slice(0, 6)}…${event.nodeWallet.slice(-4)}`
        : event.nodeWallet
      const badge = BADGE_TOKENS[badgeVariant] ?? BADGE_TOKENS['success']!

      // tabindex="0" on the popup container makes it keyboard-focusable so users
      // who open a popup via Enter/Space can Tab into it and read the content.
      // Without this, focus stays on the SVG marker and the popup is mouse-only.
      // role=region (not role=document): region supports aria-label per WAI-ARIA 1.2,
      // so AT announces the accessible name. role=document triggers NVDA/JAWS browse mode
      // which intercepts Escape before our custom keydown handler fires, causing a trap.
      const popupHtml = `
        <div tabindex="0" role="region" data-popup-content style="min-width:180px;font-family:var(--wld-font-family,sans-serif);" aria-label="${esc(event.targetUrl)}: ${esc(label)}, ${esc(ts)}, node ${esc(wallet)}">
          <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--wld-gray-0,#ffffff);">
            ${esc(event.targetUrl)}
          </div>
          <div aria-label="Block type: ${esc(label)}" style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${badge.bg};color:${badge.color};margin-bottom:8px;">
            ${esc(label)}
          </div>
          <div style="font-size:11px;color:var(--wld-gray-300,#d1d5db);margin-bottom:2px;">${esc(ts)}</div>
          <div aria-label="Node wallet: ${esc(event.nodeWallet)}" style="font-size:11px;color:var(--wld-gray-300,#d1d5db);font-family:monospace;margin-bottom:8px;">${esc(wallet)}</div>
          <button
            data-popup-close
            aria-label="Close popup"
            style="display:block;width:100%;padding:4px 0;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;color:var(--wld-gray-300,#d1d5db);font-size:11px;cursor:pointer;"
          >Close</button>
        </div>
      `

      const marker = leaflet.circleMarker([lat, lng], {
        radius: 7,
        fillColor: color,
        color: color,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.5,
      })

      marker.bindPopup(popupHtml, { maxWidth: 260 })

      const markerLabel = `${event.targetUrl}: ${label}`

      // Make markers keyboard-focusable: Leaflet SVG markers are not natively
      // keyboard-reachable. After the marker is added, patch its underlying DOM
      // element to be focusable and respond to Enter/Space.
      marker.on('add', () => {
        const el = marker.getElement?.() as HTMLElement | undefined
        if (!el) return
        el.setAttribute('tabindex', '0')
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', markerLabel)
        el.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            lastFocusedMarkerElRef.current = el
            marker.openPopup()
          }
        })
      })

      // On popup open: move keyboard focus into the popup content div so keyboard-
      // only users can read and interact with the popup without a mouse.
      // Also announce to AT via polite live region for screen-reader users.
      marker.on('popupopen', (e: any) => {
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = `${event.targetUrl}: ${label}, ${ts}`
        }
        // Track which marker opened this popup for Escape-key return path.
        const markerEl = marker.getElement?.() as HTMLElement | undefined
        if (markerEl) lastFocusedMarkerElRef.current = markerEl
        // Cancel any pending focus transfer from a previous popup cycle.
        if (focusTimeoutRef.current !== null) clearTimeout(focusTimeoutRef.current)
        focusTimeoutRef.current = setTimeout(() => {
          focusTimeoutRef.current = null
          const popup = document.querySelector<HTMLElement>('[data-popup-content]')
          // Guard: only move focus if the popup is still open and focus has not
          // already moved elsewhere (e.g. user tabbed away during the 50ms delay).
          if (!popup) return
          const activeEl = document.activeElement
          const focusIsInsideMap = mapContainerRef.current?.contains(activeEl) ?? false
          const focusIsOnMarker = activeEl === markerEl
          if (focusIsOnMarker || focusIsInsideMap) popup.focus()
        }, 50)
      })
      marker.on('popupclose', () => {
        // Cancel deferred focus transfer — popup is already gone.
        if (focusTimeoutRef.current !== null) {
          clearTimeout(focusTimeoutRef.current)
          focusTimeoutRef.current = null
        }
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = ''
        }
        // Return focus to the marker unless focus has already moved outside the map
        // (e.g. user clicked a different marker, or focus is on another page element).
        // This handles outside-click and Leaflet X-button closes — not just Escape.
        // Guard against a stale ref: if the marker was evicted by incremental diffing
        // the element is no longer in the DOM — focus() on a detached element is a no-op
        // on most AT but causes layout thrash; null the ref so we don't retry.
        if (lastFocusedMarkerElRef.current && !document.contains(lastFocusedMarkerElRef.current)) {
          lastFocusedMarkerElRef.current = null
        }
        if (!mapContainerRef.current?.contains(document.activeElement)) {
          lastFocusedMarkerElRef.current?.focus()
        }
      })
    return marker
  }

  // Shared marker render function — uses incremental diffing to avoid O(N) DOM teardown
  // on every poll cycle. Only adds markers for new event IDs and removes markers for
  // events that are no longer in the set. Common case (1-2 new events per 60s poll)
  // is O(delta) instead of O(N).
  const renderMarkers = (leaflet: any, eventsToRender: ProbeResultRow[]) => {
    if (!markersLayerRef.current) return

    const prevIds = new Set(markerMapRef.current.keys())
    const newIds = new Set(eventsToRender.map(e => e.id))

    // Remove stale markers
    for (const id of prevIds) {
      if (!newIds.has(id)) {
        const staleMarker = markerMapRef.current.get(id)
        if (staleMarker) {
          // If the focused-marker ref points to a marker we're about to evict,
          // null it so the popupclose handler doesn't try to focus a detached element.
          const staleEl = staleMarker.getElement?.() as HTMLElement | undefined
          if (staleEl && lastFocusedMarkerElRef.current === staleEl) {
            lastFocusedMarkerElRef.current = null
          }
          markersLayerRef.current.removeLayer(staleMarker)
        }
        markerMapRef.current.delete(id)
      }
    }

    // Add new markers — batch for large initial loads to avoid 200 separate
    // layer-add / tile-reflow cycles. For incremental updates (1-2 new markers
    // per 60s poll) the overhead is negligible and batching is skipped.
    const newEvents = eventsToRender.filter(e => !prevIds.has(e.id))
    const useBatch = prevIds.size === 0 && newEvents.length > 20
    if (useBatch && mapRef.current) markersLayerRef.current.remove()
    for (const event of newEvents) {
      const marker = createMarker(leaflet, event)
      markersLayerRef.current.addLayer(marker)
      markerMapRef.current.set(event.id, marker)
    }
    if (useBatch && mapRef.current) markersLayerRef.current.addTo(mapRef.current)
  }

  // Initialize map once on mount
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    let mounted = true

    const init = async () => {
      const leaflet = leafletRef.current ?? await import('leaflet')
      leafletRef.current = leaflet
      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        // SRI hash prevents a compromised unpkg CDN from serving a malicious stylesheet.
        link.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'
        link.crossOrigin = 'anonymous'
        document.head.appendChild(link)
      }

      if (!mounted || !mapContainerRef.current) return

      const map = leaflet.map(mapContainerRef.current, {
        center: [20, 0],
        zoom: 2,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
      })

      leaflet
        .tileLayer(TILE_URL, {
          attribution: TILE_ATTRIBUTION,
          subdomains: 'abcd',
          maxZoom: 19,
        })
        .addTo(map)

      markersLayerRef.current = leaflet.layerGroup().addTo(map)
      mapRef.current = map

      // Map-level popup keyboard handler: Escape inside a popup closes it and
      // returns focus to the marker that opened it — prevents keyboard trap (WCAG 2.1.2).
      // We store the timeout handle in mapPopupTimeoutRef so rapid popup-open cycles
      // (user opens marker A, then marker B within 60ms) cancel the previous pending
      // timer before scheduling a new one, preventing listener accumulation.
      map.on('popupopen', (ev: any) => {
        if (mapPopupTimeoutRef.current !== null) {
          clearTimeout(mapPopupTimeoutRef.current)
          mapPopupTimeoutRef.current = null
        }
        // Wire the Close button immediately — it must not be gated behind a setTimeout
        // because the user can click it before the 60ms fires, silently swallowing the click.
        // Leaflet's popup container DOM is available synchronously at popupopen time.
        const popupEl = ev?.popup?.getElement?.() as HTMLElement | null | undefined
        const immediatePopup = popupEl ?? document.querySelector<HTMLElement>('[data-popup-content]')
        if (immediatePopup) {
          const closeBtn = immediatePopup.querySelector<HTMLButtonElement>('[data-popup-close]')
          if (closeBtn) {
            closeBtn.onclick = () => {
              map.closePopup()
              lastFocusedMarkerElRef.current?.focus()
            }
          }
        }
        // Defer the Escape keydown listener by 60ms to avoid picking up the same keydown
        // that opened the popup (e.g. Enter/Space on marker triggers popupopen synchronously).
        mapPopupTimeoutRef.current = setTimeout(() => {
          mapPopupTimeoutRef.current = null
          const popup = document.querySelector<HTMLElement>('[data-popup-content]')
          if (!popup) return
          // Remove any stale listener from a prior cycle before adding a fresh one.
          const prevHandler = (popup as any)._escHandler as ((e: KeyboardEvent) => void) | undefined
          if (prevHandler) popup.removeEventListener('keydown', prevHandler)
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              map.closePopup()
              lastFocusedMarkerElRef.current?.focus()
            }
          }
          ;(popup as any)._escHandler = onKeyDown
          popup.addEventListener('keydown', onKeyDown, { once: true })
        }, 60)
      })

      // Apply any events that arrived while Leaflet was still initializing.
      // Without this, the first batch of events is silently dropped because the
      // events effect fires before mapRef/markersLayerRef are set.
      if (pendingEventsRef.current.length > 0) {
        renderMarkers(leaflet, pendingEventsRef.current)
      }
    }

    init()

    return () => {
      mounted = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update markers when events change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return

    const updateMarkers = async () => {
      const gen = ++markerGenRef.current
      // Use cached leaflet module — avoids a dynamic import() call on every events change.
      // leafletRef is populated by the init effect; if it's still null, init hasn't finished
      // yet and pendingEventsRef will ensure markers are applied once init completes.
      const leaflet = leafletRef.current ?? await import('leaflet')
      leafletRef.current = leaflet
      if (gen !== markerGenRef.current) return
      renderMarkers(leaflet, events)
    }

    updateMarkers()
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  // Announce empty-map state to AT after a filter change zeroes the results.
  // Uses a SEPARATE live region (filterLiveRef) from the popup announcement region
  // (liveRegionRef) to prevent background polls from clearing popup announcements.
  // Only fires after we've seen at least one event — suppresses the false "no events"
  // announcement that would otherwise fire on initial load before data arrives.
  useEffect(() => {
    if (!filterLiveRef.current) return
    if (events.length > 0) {
      hasEverHadEventsRef.current = true
      // Clear any prior "no events" message when results return
      filterLiveRef.current.textContent = ''
      return
    }
    // events.length === 0: only announce if we previously had events (filter change),
    // not on initial load where the fetch is still in-flight.
    if (hasEverHadEventsRef.current) {
      filterLiveRef.current.textContent = 'No events match your current filter on the map'
    }
  }, [events.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
      // Clear the incremental diff state so a remount doesn't skip re-adding markers
      // whose IDs were present in the previous mount's markerMapRef. Without this,
      // a hot-reload or React strict-mode double-mount would skip all events that
      // were already in the map (IDs are the same but the Leaflet layer is gone).
      markerMapRef.current.clear()
      markersLayerRef.current = null
    }
  }, [])

  return (
    <div className="relative h-full w-full">
      {/* Skip link — always in DOM so the Escape handler always has a focus target.
          When sidebar is open: navigates to #events-panel.
          When sidebar is closed: a button that moves focus past the map to the
          first focusable element in the header (ensuring no keyboard trap). */}
      {sidebarOpen ? (
        <a
          href="#events-panel"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold"
          style={{ backgroundColor: 'var(--wld-gray-0)', color: 'var(--wld-gray-900)' }}
          data-map-escape-target
        >
          Skip to events list
        </a>
      ) : (
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold"
          style={{ backgroundColor: 'var(--wld-gray-0)', color: 'var(--wld-gray-900)' }}
          data-map-escape-target
          onClick={() => {
            // Move focus to the first interactive element outside the map container
            const header = document.querySelector<HTMLElement>('header')
            const focusable = header?.querySelector<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )
            focusable?.focus()
          }}
        >
          Exit map
        </button>
      )}

      {/* Popup announcement live region — announces marker popup details to AT.
          No aria-label: role=generic does not support name-from-author per ARIA 1.2,
          so any aria-label would be silently ignored. The region content is self-
          describing (URL + block type + timestamp), so no label is needed. */}
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      {/* Filter state live region — separate from popup region so background polls
          that clear this (when count > 0) do not interrupt popup announcements.
          Announces "no events" only when a filter change zeros the results. */}
      <div ref={filterLiveRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      <div
        ref={mapContainerRef}
        role="application"
        className="h-full w-full"
        style={{ minHeight: 300 }}
        aria-label={sidebarOpen
          ? 'Censorship events world map. Use arrow keys to pan, plus and minus keys to zoom. Tab to cycle through event markers; press Enter or Space on a marker to open details. When a popup is open, press Escape to close it and return to the marker, or Tab to the Close button. Press Escape with no popup open to move focus to the skip link.'
          : 'Censorship events world map. Use arrow keys to pan, plus and minus keys to zoom. Tab to cycle through event markers; press Enter or Space on a marker to open details. When a popup is open, press Escape to close it and return to the marker. Press Escape with no popup open to exit the map.'}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            const escapeTarget = (e.currentTarget.parentElement as HTMLElement)?.querySelector<HTMLElement>('[data-map-escape-target]')
            escapeTarget?.focus()
          }
        }}
      />
    </div>
  )
}
