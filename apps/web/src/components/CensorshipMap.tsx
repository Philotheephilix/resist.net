'use client'

import 'leaflet/dist/leaflet.css'
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
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
  if (s !== undefined) {
    tsLocaleMapCache.delete(ts)
    tsLocaleMapCache.set(ts, s)
    return s
  }
  s = new Date(ts).toLocaleString()
  if (tsLocaleMapCache.size >= TS_CACHE_MAX) tsLocaleMapCache.delete(tsLocaleMapCache.keys().next().value!)
  tsLocaleMapCache.set(ts, s)
  return s
}
function cachedGeohashToLatLng(hash: string): [number, number] {
  let latlng = geohashCache.get(hash)
  if (latlng) {
    geohashCache.delete(hash)
    geohashCache.set(hash, latlng)
    return latlng
  }
  latlng = geohashToLatLng(hash) as [number, number]
  if (geohashCache.size >= GEO_CACHE_MAX) geohashCache.delete(geohashCache.keys().next().value!)
  geohashCache.set(hash, latlng)
  return latlng
}

// HTML-escape for injecting user-controlled strings into popup innerHTML.
// Module-level LRU cache: targetUrl/label/wallet repeat heavily across markers
// for the same blocked site — cache hit rate is high in real censorship datasets.
const ESC_CACHE_MAX = 500
const escCache = new Map<string, string>()
const esc = (s: string): string => {
  let r = escCache.get(s)
  if (r !== undefined) {
    escCache.delete(s)
    escCache.set(s, r)
    return r
  }
  r = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  if (escCache.size >= ESC_CACHE_MAX) escCache.delete(escCache.keys().next().value!)
  escCache.set(s, r)
  return r
}

// Stadia Alidade Smooth Dark — no API key required for open source / non-commercial projects
const TILE_URL =
  'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps<span class="sr-only"> (opens in new tab)</span></a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles<span class="sr-only"> (opens in new tab)</span></a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

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

export default memo(function CensorshipMap({ events, sidebarOpen = true }: CensorshipMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersLayerRef = useRef<any>(null)
  const markerGenRef = useRef(0)
  // popupInstructionsVisibleRef: tracks whether popup-Escape hint has been appended.
  // Stored as a ref (not state) to avoid triggering a React re-render on first popup open.
  // The aria-label is updated imperatively via mapContainerRef when the hint should appear.
  const popupInstructionsVisibleRef = useRef(false)
  // sidebarOpenRef: mirrors the sidebarOpen prop so imperative aria-label updates
  // in Leaflet event handlers (which capture the initial ref value) stay in sync
  // with the latest prop without needing a re-render or closure re-creation.
  const sidebarOpenRef = useRef(sidebarOpen)
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
  // hasEverOpenedPopupRef: tracks whether any popup has been opened this session.
  // Used to add popup-Escape instructions to the map container aria-label only after
  // the user has interacted with a marker — avoids noisy instructions before first use.
  const hasEverOpenedPopupRef = useRef(false)
  // popupClosedByActionRef: true when the popup was closed by Escape or the Close button.
  // The popupclose handler only restores focus to the marker when this is true — it must
  // NOT restore focus when the user Tabbed out of the popup (focus left the popup
  // intentionally; restoring it would yank focus backward against user intent).
  const popupClosedByActionRef = useRef(false)
  const popupIsOpenRef = useRef(false)
  // liveRegionClearTimeoutRef: handle for the 1500ms clear after "Popup closed" announcement.
  // Stored so it can be cancelled when the next popup opens before the 1500ms fires,
  // preventing the stale clear from silencing the new popup's announcement.
  const liveRegionClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchRafRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)

  // Keep sidebarOpenRef in sync via useLayoutEffect so it is only written after
  // React commits the render. Writing directly in the render body could update the
  // ref during a speculative (aborted) concurrent render, causing Leaflet callbacks
  // that fire between renders to read a stale or transient value.
  // useLayoutEffect runs synchronously after commit but before paint, so the ref
  // is always current by the time any Leaflet popupopen handler fires.
  useLayoutEffect(() => { sidebarOpenRef.current = sidebarOpen }, [sidebarOpen])

  // Update the map container's aria-label imperatively without triggering a React
  // re-render — used when popup instructions become visible for the first time.
  const updateMapAriaLabel = useCallback(() => {
    if (!mapContainerRef.current) return
    const open = sidebarOpenRef.current
    const base = open
      ? 'Censorship events world map. Use arrow keys to pan, plus and minus keys to zoom. Tab to cycle through event markers; press Enter or Space on a marker to open details. Press Escape to move focus to the skip link.'
      : 'Censorship events world map. Use arrow keys to pan, plus and minus keys to zoom. Tab to cycle through event markers; press Enter or Space on a marker to open details. Press Escape to exit the map.'
    const hint = open
      ? ' When a popup is open, press Escape to close it and return to the marker, or Tab to the Close button.'
      : ' When a popup is open, press Escape to close it and return to the marker.'
    mapContainerRef.current.setAttribute('aria-label', base + (popupInstructionsVisibleRef.current ? hint : ''))
  }, [])  // refs only — stable identity, empty dep array is correct
  useEffect(() => { updateMapAriaLabel() }, [sidebarOpen, updateMapAriaLabel])

  // Create a single marker DOM element and bind events. Extracted so it can be called
  // for both incremental adds (new event IDs) and full re-init.
  const createMarker = useCallback((leaflet: any, event: ProbeResultRow) => {
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
          <div style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${badge.bg};color:${badge.color};margin-bottom:8px;">
            <span class="sr-only">Block type: </span>${esc(label)}
          </div>
          <div style="font-size:11px;color:var(--wld-gray-300,#d1d5db);margin-bottom:2px;">${esc(ts)}</div>
          <div style="font-size:11px;color:var(--wld-gray-300,#d1d5db);font-family:monospace;margin-bottom:8px;"><span class="sr-only">Node: </span>${esc(wallet)}</div>
          <button
            data-popup-close
            aria-label="Close popup"
            style="display:block;width:100%;padding:13px 0;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:transparent;color:var(--wld-gray-300,#d1d5db);font-size:11px;cursor:pointer;"
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

      // closeButton: false — disable Leaflet's native close button (<a href='#'> in the
      // popup header) which is keyboard-reachable but not wired to popupClosedByActionRef.
      // The custom [data-popup-close] button is already the sole close mechanism; keeping
      // the native button means Tab-navigating to it and pressing Enter closes the popup
      // without restoring focus to the marker.
      marker.bindPopup(popupHtml, { maxWidth: 260, closeButton: false })

      const markerLabel = `${event.targetUrl}: ${label}`

      // Make markers keyboard-focusable: Leaflet SVG markers are not natively
      // keyboard-reachable. After the marker is added, patch its underlying DOM
      // element to be focusable and respond to Enter/Space.
      // In batch mode the layer is detached during add, so defer via rAF to avoid
      // forcing style/layout recalcs before the layer is back on the map.
      const patchMarkerElement = () => {
        const el = marker.getElement?.() as HTMLElement | undefined
        if (!el) return
        el.setAttribute('tabindex', '0')
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', markerLabel)
        // Inject an SVG <title> as the universally-supported accessible name source
        // for SVG elements. NVDA+Firefox prioritises <title> over aria-label for SVG
        // shape elements, so without this the user would hear only the role ('button')
        // and not the URL or block type when the marker receives keyboard focus.
        if (el.namespaceURI === 'http://www.w3.org/2000/svg' || el.tagName === 'path' || el.tagName === 'circle') {
          const existing = el.querySelector('title')
          if (!existing) {
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title')
            titleEl.textContent = markerLabel
            el.prepend(titleEl)
          }
        }
        const keyHandler = (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            lastFocusedMarkerElRef.current = el
            marker.openPopup()
          }
        }
        ;(el as any)._keydownHandler = keyHandler
        el.addEventListener('keydown', keyHandler)
      }
      ;(marker as any)._patchElement = patchMarkerElement
      marker.on('add', () => {
        if ((marker as any)._batchPatch) return
        if (typeof requestAnimationFrame !== 'undefined') {
          ;(marker as any)._addRafId = requestAnimationFrame(patchMarkerElement)
        } else {
          patchMarkerElement()
        }
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
        const popupEl = e?.popup?.getElement?.() as HTMLElement | null | undefined
        focusTimeoutRef.current = setTimeout(() => {
          focusTimeoutRef.current = null
          const popup = popupEl ?? document.querySelector<HTMLElement>('[data-popup-content]')
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
        // Do NOT unconditionally clear the live region here. If the user clicks a second
        // marker immediately, Leaflet fires popupclose then popupopen synchronously —
        // the empty write in popupclose followed immediately by the content write in
        // popupopen can cause VoiceOver on iOS/macOS to drain the buffer and suppress
        // the new popup's announcement. popupopen always overwrites the region content,
        // so the clear here is redundant. The 1500ms deferred clear below handles
        // the non-action-close case where no new popup follows.
        // Return focus to the marker unless focus has already moved outside the map
        // (e.g. user clicked a different marker, or focus is on another page element).
        // This handles outside-click and Leaflet X-button closes — not just Escape.
        // Guard against a stale ref: if the marker was evicted by incremental diffing
        // the element is no longer in the DOM — focus() on a detached element is a no-op
        // on most AT but causes layout thrash; null the ref so we don't retry.
        if (lastFocusedMarkerElRef.current && !document.contains(lastFocusedMarkerElRef.current)) {
          lastFocusedMarkerElRef.current = null
        }
        // Only restore focus when the popup was closed via Escape or the Close button.
        // When the user Tabs out of the popup, focus has already moved to the next element
        // in page order — restoring it to the marker would yank focus backward against intent.
        const wasAction = popupClosedByActionRef.current
        popupClosedByActionRef.current = false
        if (wasAction && !mapContainerRef.current?.contains(document.activeElement)) {
          lastFocusedMarkerElRef.current?.focus()
          // Brief AT announcement so screen reader users know where focus went.
          // Without this, focus returns silently and the user may be disoriented.
          if (liveRegionRef.current) {
            if (liveRegionClearTimeoutRef.current !== null) {
              clearTimeout(liveRegionClearTimeoutRef.current)
              liveRegionClearTimeoutRef.current = null
            }
            liveRegionRef.current.textContent = 'Popup closed. Focus returned to marker.'
            liveRegionClearTimeoutRef.current = setTimeout(() => {
              liveRegionClearTimeoutRef.current = null
              if (liveRegionRef.current) liveRegionRef.current.textContent = ''
            }, 1500)
          }
        }
      })
    return marker
  }, [])  // reads only refs and module-level caches — stable, empty dep array correct

  // Shared marker render function — uses incremental diffing to avoid O(N) DOM teardown
  // on every poll cycle. Only adds markers for new event IDs and removes markers for
  // events that are no longer in the set. Common case (1-2 new events per 60s poll)
  // is O(delta) instead of O(N).
  const renderMarkers = useCallback((leaflet: any, eventsToRender: ProbeResultRow[]) => {
    if (!markersLayerRef.current) return

    // Use Map directly for stale-check — no need to copy all keys into a Set.
    const newIds = new Set<string>()
    for (const e of eventsToRender) newIds.add(e.id)

    // Remove stale markers
    for (const id of markerMapRef.current.keys()) {
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
    const newEvents = eventsToRender.filter(e => !markerMapRef.current.has(e.id))
    const useBatch = markerMapRef.current.size === 0 && newEvents.length > 20
    if (useBatch && mapRef.current) markersLayerRef.current.remove()
    const batchMarkers: any[] = []
    for (const event of newEvents) {
      const marker = createMarker(leaflet, event)
      if (useBatch) {
        ;(marker as any)._batchPatch = true
      }
      markersLayerRef.current.addLayer(marker)
      markerMapRef.current.set(event.id, marker)
      batchMarkers.push(marker)
    }
    if (useBatch && mapRef.current) {
      markersLayerRef.current.addTo(mapRef.current)
    }
    if (batchMarkers.length > 0) {
      if (typeof requestAnimationFrame !== 'undefined') {
        if (batchRafRef.current !== null) cancelAnimationFrame(batchRafRef.current)
        batchRafRef.current = requestAnimationFrame(() => {
          batchRafRef.current = null
          for (const m of batchMarkers) {
            const patch = m._patchElement as (() => void) | undefined
            if (patch) patch()
          }
        })
      } else {
        for (const m of batchMarkers) {
          const patch = m._patchElement as (() => void) | undefined
          if (patch) patch()
        }
      }
    }
  }, [createMarker])  // createMarker is stable (empty dep array) — this is also stable

  const renderMarkersRef = useRef(renderMarkers)
  useLayoutEffect(() => {
    renderMarkersRef.current = renderMarkers
  })

  // Initialize map once on mount
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    let mounted = true
    let localMap: any = null

    const init = async () => {
      const leaflet = leafletRef.current ?? await import('leaflet')
      leafletRef.current = leaflet
      if (!mounted || !mapContainerRef.current) return

      const map = leaflet.map(mapContainerRef.current, {
        center: [20, 0],
        zoom: 2,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        keyboard: true,
      })

      leaflet
        .tileLayer(TILE_URL, {
          attribution: TILE_ATTRIBUTION,
          subdomains: 'abcd',
          maxZoom: 19,
        })
        .addTo(map)

      markersLayerRef.current = leaflet.layerGroup().addTo(map)
      localMap = map
      mapRef.current = map

      // Map-level popup keyboard handler: Escape inside a popup closes it and
      // returns focus to the marker that opened it — prevents keyboard trap (WCAG 2.1.2).
      // We store the timeout handle in mapPopupTimeoutRef so rapid popup-open cycles
      // (user opens marker A, then marker B within 60ms) cancel the previous pending
      // timer before scheduling a new one, preventing listener accumulation.
      map.on('popupopen', (ev: any) => {
        popupIsOpenRef.current = true
        if (!hasEverOpenedPopupRef.current) {
          hasEverOpenedPopupRef.current = true
          // Update the aria-label synchronously so the Escape hint is present
          // before the screen reader reads the popup open announcement.
          // Updating an outer container's aria-label is safe inside Leaflet's
          // synchronous event dispatch — it only touches our own div, not Leaflet's DOM.
          popupInstructionsVisibleRef.current = true
          updateMapAriaLabel()
        }
        // Cancel any pending liveRegion clear from the previous "Popup closed" announcement
        // so it doesn't silently blank the new popup's open announcement.
        if (liveRegionClearTimeoutRef.current !== null) {
          clearTimeout(liveRegionClearTimeoutRef.current)
          liveRegionClearTimeoutRef.current = null
        }
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
              popupClosedByActionRef.current = true
              map.closePopup()
              lastFocusedMarkerElRef.current?.focus()
            }
          }
        }
        // Defer the Escape keydown listener by 60ms to avoid picking up the same keydown
        // that opened the popup (e.g. Enter/Space on marker triggers popupopen synchronously).
        mapPopupTimeoutRef.current = setTimeout(() => {
          mapPopupTimeoutRef.current = null
          const popup = immediatePopup
          if (!popup) return
          // Remove any stale listener from a prior cycle before adding a fresh one.
          const prevHandler = (popup as any)._escHandler as ((e: KeyboardEvent) => void) | undefined
          if (prevHandler) popup.removeEventListener('keydown', prevHandler)
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              popupClosedByActionRef.current = true
              // Remove before closing to prevent the handler from firing again on the
              // next popup in case popupclose doesn't clean up quickly enough.
              popup.removeEventListener('keydown', onKeyDown)
              ;(popup as any)._escHandler = null
              map.closePopup()
              lastFocusedMarkerElRef.current?.focus()
            }
          }
          ;(popup as any)._escHandler = onKeyDown
          // Do NOT use { once: true } — it consumes the listener on the FIRST keydown
          // regardless of key. A Tab press while the popup is open would silently absorb
          // the listener, so a subsequent Escape would not set popupClosedByActionRef.
          popup.addEventListener('keydown', onKeyDown)
        }, 60)
      })

      map.on('popupclose', () => {
        popupIsOpenRef.current = false
      })

      // Apply any events that arrived while Leaflet was still initializing.
      // Without this, the first batch of events is silently dropped because the
      // events effect fires before mapRef/markersLayerRef are set.
      if (pendingEventsRef.current.length > 0) {
        renderMarkersRef.current(leaflet, pendingEventsRef.current)
      }
    }

    init()

    return () => {
      mounted = false
      localMap?.remove()
      localMap = null
      mapRef.current = null
    }
  }, [])

  // Update markers when events change
  useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current) return

    let mounted = true
    const updateMarkers = async () => {
      const gen = ++markerGenRef.current
      // Use cached leaflet module — avoids a dynamic import() call on every events change.
      // leafletRef is populated by the init effect; if it's still null, init hasn't finished
      // yet and pendingEventsRef will ensure markers are applied once init completes.
      const leaflet = leafletRef.current ?? await import('leaflet')
      if (!mounted) return
      leafletRef.current = leaflet
      if (gen !== markerGenRef.current) return
      renderMarkers(leaflet, events)
    }

    updateMarkers()
    return () => { mounted = false }
  }, [events, renderMarkers])

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
      // Cancel pending timeouts before removing the map to prevent their callbacks
      // from firing against the unmounted component's stale refs.
      if (mapPopupTimeoutRef.current !== null) { clearTimeout(mapPopupTimeoutRef.current); mapPopupTimeoutRef.current = null }
      if (focusTimeoutRef.current !== null) { clearTimeout(focusTimeoutRef.current); focusTimeoutRef.current = null }
      if (liveRegionClearTimeoutRef.current !== null) { clearTimeout(liveRegionClearTimeoutRef.current); liveRegionClearTimeoutRef.current = null }
      if (batchRafRef.current !== null) { cancelAnimationFrame(batchRafRef.current); batchRafRef.current = null }
      // Explicitly remove keydown listeners stored on each marker's SVG element.
      // Relying solely on Leaflet's map.remove() to free them is safe in real browsers
      // but leaks in jsdom test environments where the SVG container may be retained.
      markerMapRef.current.forEach(m => {
        if ((m as any)._addRafId) { cancelAnimationFrame((m as any)._addRafId); (m as any)._addRafId = null }
        const el = m.getElement?.() as any
        if (el && el._keydownHandler) { el.removeEventListener('keydown', el._keydownHandler); el._keydownHandler = null }
      })
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
      hasEverHadEventsRef.current = false
    }
  }, [])

  return (
    <div className="relative h-full w-full group">
      {/* Skip link — always in DOM so the Escape handler always has a focus target.
          When sidebar is open: navigates to #events-panel.
          When sidebar is closed: a button that moves focus past the map to the
          first focusable element in the header (ensuring no keyboard trap). */}
      {sidebarOpen ? (
        <a
          href="#events-panel"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold"
          style={{ backgroundColor: 'var(--wld-gray-0, #ffffff)', color: 'var(--wld-gray-900, #111827)' }}
          data-map-escape-target
        >
          Skip to events list
        </a>
      ) : (
        <button
          type="button"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold"
          style={{ backgroundColor: 'var(--wld-gray-0, #ffffff)', color: 'var(--wld-gray-900, #111827)' }}
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
      <div ref={liveRegionRef} aria-live="polite" className="sr-only" />

      {/* Filter state live region — separate from popup region so background polls
          that clear this (when count > 0) do not interrupt popup announcements.
          Announces "no events" only when a filter change zeros the results. */}
      <div ref={filterLiveRef} aria-live="polite" aria-atomic="true" className="sr-only" />

      <p
        id="map-keyboard-instructions"
        className="sr-only group-focus-within:not-sr-only group-focus-within:absolute group-focus-within:bottom-2 group-focus-within:left-1/2 group-focus-within:-translate-x-1/2 group-focus-within:z-50 group-focus-within:rounded group-focus-within:px-3 group-focus-within:py-1 group-focus-within:text-xs group-focus-within:font-medium group-focus-within:pointer-events-none"
        style={{ backgroundColor: 'var(--wld-gray-900)', color: 'var(--wld-gray-0)' }}
      >
        Use arrow keys to pan, +/− to zoom, Tab to cycle markers, Escape to exit
      </p>

      {/* Empty-state overlay — shown when a filter produces no results for sighted users.
          Gated by hasEverHadEventsRef so it does not flash during initial load before
          the first fetch completes. pointer-events: none ensures map interaction is
          not blocked (pan/zoom still work underneath the badge). */}
      {events.length === 0 && hasEverHadEventsRef.current && (
        <div
          className="absolute inset-0 z-[500] flex items-center justify-center pointer-events-none"
          aria-hidden="true"
        >
          <span
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{
              backgroundColor: 'var(--wld-gray-900, #111827)',
              color: 'var(--wld-gray-0, #ffffff)',
              opacity: 0.85,
            }}
          >
            No events for this filter
          </span>
        </div>
      )}

      <div
        ref={mapContainerRef}
        role="application"
        aria-label="Censorship events world map"
        aria-describedby="map-keyboard-instructions"
        className="h-full w-full"
        style={{ minHeight: 300 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // If a popup is open, close it first so popupclose fires, then focus the
            // escape target. Without closePopup() the popup stays open, popupclose never
            // fires, and popupClosedByActionRef stays true — stale — for the next cycle.
            if (popupIsOpenRef.current && mapRef.current) {
              popupClosedByActionRef.current = true
              mapRef.current.closePopup()
            }
            const escapeTarget = (e.currentTarget.parentElement as HTMLElement)?.querySelector<HTMLElement>('[data-map-escape-target]')
            escapeTarget?.focus()
          }
        }}
      />
    </div>
  )
})
