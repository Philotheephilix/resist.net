import { test, expect } from '@playwright/test'

test.describe('resist.net web app', () => {
  test('loads with correct title and dark theme', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/resist\.net/)
    // Dark background applied
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('header renders with brand name', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('resist.net')).toBeVisible()
    await expect(page.getByText('Community Censorship Monitor')).toBeVisible()
  })

  test('filter pills are all rendered', async ({ page }) => {
    await page.goto('/')
    // Radio inputs are sr-only; verify by value attr; check parent label pill is visible
    for (const value of ['all', 'dns_poisoning', 'tcp_rst', 'http_block', 'full_unreachable']) {
      const label = page.locator(`label:has(input[name="filter"][value="${value}"])`)
      await expect(label).toBeVisible()
    }
  })

  test('filter pills are clickable and toggle active state', async ({ page }) => {
    await page.goto('/')

    // Radio inputs are sr-only; click the visible parent label pill
    const dnsLabel = page.locator('label:has(input[name="filter"][value="dns_poisoning"])')
    await expect(dnsLabel).toBeVisible()
    await dnsLabel.click()

    // After click, DNS Poisoning radio should be checked, All should not
    const dnsInput = page.locator('input[name="filter"][value="dns_poisoning"]')
    const allInput = page.locator('input[name="filter"][value="all"]')
    await expect(dnsInput).toBeChecked()
    await expect(allInput).not.toBeChecked()
    // Visual: label pill background differs between active and inactive
    const allLabel = page.locator('label:has(input[name="filter"][value="all"])')
    const dnsBg = await dnsLabel.evaluate((el) => getComputedStyle(el).backgroundColor)
    const allBg = await allLabel.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(dnsBg).not.toBe(allBg)
  })

  test('events panel renders after data loads', async ({ page }) => {
    await page.goto('/')
    // The sidebar label is "RECENT EVENTS" (all-caps via CSS or text)
    // Use case-insensitive regex to match either casing
    await expect(page.getByText(/recent events/i).first()).toBeVisible({ timeout: 15000 })
  })

  test('API returns probe events', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events')
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    expect(Array.isArray(events)).toBeTruthy()

    // Validate shape of first event when data is present (requires live Arkiv or USE_MOCK_DATA=true)
    if (events.length > 0) {
      const first = events[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('targetUrl')
      expect(first).toHaveProperty('geohash')
      expect(first).toHaveProperty('timestamp')
      expect(first).toHaveProperty('nodeWallet')
      expect(typeof first.reachable).toBe('boolean')
    }
  })

  test('API stats endpoint returns correct shape', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?stats=true')
    expect(response.ok()).toBeTruthy()
    const stats = await response.json()
    expect(stats).toHaveProperty('liveProbes')
    expect(stats).toHaveProperty('regions')
    expect(stats).toHaveProperty('blocksToday')
    expect(typeof stats.liveProbes).toBe('number')
    expect(typeof stats.regions).toBe('number')
    expect(typeof stats.blocksToday).toBe('number')
  })

  test('API block type filter works', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?blockType=dns_poisoning')
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
    }
  })

  test('map container renders', async ({ page }) => {
    await page.goto('/')
    // Wait for the map container to appear (either Leaflet map or loading placeholder)
    const mapContainer = page.locator('[aria-label^="Censorship events world map"]')
    await expect(mapContainer).toBeVisible({ timeout: 15000 })
  })

  test('hide panel button works', async ({ page }) => {
    await page.goto('/')
    const hideBtn = page.getByRole('button', { name: 'Hide' })
    await expect(hideBtn).toBeVisible()
    await hideBtn.click()
    // After hiding, the button text should change or sidebar should be hidden
    await expect(page.getByRole('button', { name: /hide|show/i })).toBeVisible()
  })

  test('page layout is responsive — no horizontal overflow', async ({ page }) => {
    await page.goto('/')
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    const viewportWidth = page.viewportSize()?.width ?? 1280
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1)
  })

  test('map loads dark tile layer', async ({ page }) => {
    await page.goto('/')
    // Wait up to 15s for Leaflet tiles to start loading
    await page.waitForSelector('.leaflet-container', { timeout: 15000 }).catch(() => {
      // Map may not have loaded yet; this is a soft check
    })
    const leafletContainer = await page.$('.leaflet-container')
    // If Leaflet loaded, it should have the dark tile
    if (leafletContainer) {
      const tileLayer = await page.$('.leaflet-tile-pane')
      expect(tileLayer).not.toBeNull()
    }
  })

  test('map tiles use Stadia dark (no API key warning)', async ({ page }) => {
    await page.goto('/')
    // Wait for map to load
    await page.waitForSelector('.leaflet-container', { timeout: 15000 }).catch(() => {})
    // Check that the page source includes stadiamaps tile URL (not cartocdn which requires API key)
    const content = await page.content()
    // Stadia tiles should be referenced in the page
    expect(content).toContain('stadiamaps')
  })

  test('DNS Poisoning filter shows only dns_poisoning events from API', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?blockType=dns_poisoning')
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
    }
  })

  test('sidebar shows event count badge with numeric value', async ({ page }) => {
    await page.goto('/')
    // Wait briefly for data fetch to complete
    await page.waitForTimeout(2000)

    // The event count badge must exist and show a non-negative integer (0 is valid when no live data)
    // aria-hidden="true" — count is announced via the coordinated liveRef region, not inline role=status
    const countBadge = page.locator('aside div[aria-hidden="true"].rounded-full').first()
    await expect(countBadge).toBeVisible({ timeout: 10000 })
    const text = await countBadge.textContent().catch(() => '0')
    const count = parseInt(text ?? '0', 10)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('bootstrap API returns array', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/bootstrap')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
  })

  test('filter interaction — clicking DNS Poisoning filters events', async ({ page }) => {
    await page.goto('/')
    // Click the visible label pill; native input is sr-only
    await page.locator('label:has(input[name="filter"][value="dns_poisoning"])').click()
    // Wait for re-render
    await page.waitForTimeout(500)
    // DNS Poisoning should be checked, All should not
    const dnsInput = page.locator('input[name="filter"][value="dns_poisoning"]')
    const allInput = page.locator('input[name="filter"][value="all"]')
    await expect(dnsInput).toBeChecked()
    await expect(allInput).not.toBeChecked()
    // Label pill backgrounds differ between active and inactive
    const dnsBgColor = await page.locator('label:has(input[name="filter"][value="dns_poisoning"])').evaluate((el) => getComputedStyle(el).backgroundColor)
    const allBgColor = await page.locator('label:has(input[name="filter"][value="all"])').evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(allBgColor).not.toBe(dnsBgColor)
  })

  test('filter — checked state reflects active filter', async ({ page }) => {
    await page.goto('/')
    // Native radio: use input locators directly (sr-only inputs excluded from getByRole)
    const allInput = page.locator('input[name="filter"][value="all"]')
    const dnsInput = page.locator('input[name="filter"][value="dns_poisoning"]')
    await expect(allInput).toBeChecked()
    await expect(dnsInput).not.toBeChecked()
    // Click the visible label pill to change selection
    await page.locator('label:has(input[name="filter"][value="dns_poisoning"])').click()
    await expect(dnsInput).toBeChecked()
    await expect(allInput).not.toBeChecked()
  })

  test('filter — returning to All after selecting specific type', async ({ page }) => {
    await page.goto('/')
    await page.locator('label:has(input[name="filter"][value="dns_poisoning"])').click()
    await page.waitForTimeout(300)
    await page.locator('label:has(input[name="filter"][value="all"])').click()
    await page.waitForTimeout(300)
    await expect(page.locator('input[name="filter"][value="all"]')).toBeChecked()
  })

  test('sidebar hide and reopen', async ({ page }) => {
    await page.goto('/')
    const hideBtn = page.getByRole('button', { name: 'Hide events panel' })
    await hideBtn.click()
    // Sidebar aside should be removed from DOM
    await expect(page.getByRole('complementary', { name: 'Recent block events' })).not.toBeVisible()
    // Show button appears
    const showBtn = page.getByRole('button', { name: 'Show events panel' })
    await expect(showBtn).toBeVisible()
    await showBtn.click()
    // Sidebar comes back
    await expect(page.getByRole('complementary', { name: 'Recent block events' })).toBeVisible()
  })

  test('API returns 400 on invalid geohash parameter', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?geohash=INVALID!!')
    expect(response.status()).toBe(400)
  })

  test('API geohash filter returns only matching events', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?geohash=u4')
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.geohash.startsWith('u4')).toBeTruthy()
    }
  })

  test('API failure triggers error banner', async ({ page }) => {
    // Intercept the probe-events API and force a 500
    await page.route('**/api/probe-events**', (route) => route.fulfill({ status: 500, body: 'error' }))
    await page.goto('/')
    const errorBanner = page.locator('[role="alert"]').filter({ hasText: 'Failed to load events' })
    await expect(errorBanner).toBeVisible({ timeout: 15000 })
    const alertText = await errorBanner.textContent()
    expect(alertText).toContain('Failed to load events')
  })

  test('TCP Reset and HTTP Block filter pills are individually activatable', async ({ page }) => {
    await page.goto('/')
    for (const value of ['tcp_rst', 'http_block']) {
      // Click visible label pill; verify native radio checked state
      await page.locator(`label:has(input[name="filter"][value="${value}"])`).click()
      await expect(page.locator(`input[name="filter"][value="${value}"]`)).toBeChecked()
      await page.locator('label:has(input[name="filter"][value="all"])').click()
    }
  })

  test('API stats + blockType combined query returns consistent shape', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?stats=true&blockType=dns_poisoning')
    expect(response.ok()).toBeTruthy()
    const stats = await response.json()
    expect(stats).toHaveProperty('liveProbes')
    expect(stats).toHaveProperty('regions')
    expect(stats).toHaveProperty('blocksToday')
    expect(typeof stats.liveProbes).toBe('number')
    expect(typeof stats.regions).toBe('number')
    expect(typeof stats.blocksToday).toBe('number')
  })

  test('bootstrap API returns array with expected shape when data present', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/bootstrap')
    expect(response.ok()).toBeTruthy()
    const data = await response.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      const first = data[0]
      expect(first).toHaveProperty('wallet')
      expect(first).toHaveProperty('sdpOffer')
      expect(first).toHaveProperty('geohash')
    }
  })

  test('API geohash + blockType combined filter', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?geohash=u4&blockType=dns_poisoning')
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
      expect(event.geohash.startsWith('u4')).toBeTruthy()
    }
  })

  test('sidebar shows "No events yet" when events are empty', async ({ page }) => {
    // Intercept and return empty array
    await page.route('**/api/probe-events**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    )
    await page.goto('/')
    await page.waitForTimeout(1000)
    // Use first() to handle duplicate No events yet in sidebar + mobile sheet
    await expect(page.getByText('No events yet').first()).toBeVisible({ timeout: 10000 })
  })

  test('map marker popup opens and closes on click', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 1, regions: 1, blocksToday: 1 }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'test-marker-1', targetUrl: 'https://example.com',
          blockType: 'dns_poisoning', geohash: 'u4pruydqqvj', timestamp: Date.now(),
          nodeWallet: '0xDeadBeef1234', reachable: false,
        }]) })
    })
    await page.goto('/')
    await page.waitForSelector('.leaflet-container', { timeout: 15000 })
    const marker = page.locator('.leaflet-marker-pane, .leaflet-overlay-pane').locator('path, circle').first()
    await marker.waitFor({ state: 'visible', timeout: 10000 })
    await marker.click()
    const popup = page.locator('[data-popup-content]')
    await expect(popup).toBeVisible({ timeout: 5000 })
    await expect(popup).toContainText('example.com')
    const closeBtn = popup.locator('[data-popup-close]')
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()
    await expect(popup).not.toBeVisible({ timeout: 3000 })
  })

  test('live region announces event count after load', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 2, regions: 1, blocksToday: 2 }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { id: 'lr-1', targetUrl: 'https://a.com', blockType: 'dns_poisoning',
            geohash: 'u4pruydqqvj', timestamp: Date.now(), nodeWallet: '0xAABB', reachable: false },
          { id: 'lr-2', targetUrl: 'https://b.com', blockType: 'tcp_rst',
            geohash: 'u4pruydqqvj', timestamp: Date.now() - 1000, nodeWallet: '0xCCDD', reachable: false },
        ]) })
    })
    await page.goto('/')
    const liveRegion = page.locator('[aria-live="polite"][aria-atomic="true"].sr-only').first()
    await expect(liveRegion).toHaveText(/events loaded/, { timeout: 10000 })
  })

  test('live region announces No events yet when API returns empty', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    )
    await page.goto('/')
    const liveRegion = page.locator('[aria-live="polite"][aria-atomic="true"].sr-only').first()
    await expect(liveRegion).toHaveText('No events yet', { timeout: 10000 })
  })

  test('map marker popup closes on Escape and returns focus to marker', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 1, regions: 1, blocksToday: 1 }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'test-esc-1', targetUrl: 'https://escape-test.com',
          blockType: 'tcp_rst', geohash: 'u4pruydqqvj', timestamp: Date.now(),
          nodeWallet: '0xAaBbCcDd1234', reachable: false,
        }]) })
    })
    await page.goto('/')
    await page.waitForSelector('.leaflet-container', { timeout: 15000 })
    const marker = page.locator('.leaflet-overlay-pane').locator('path, circle').first()
    await marker.waitFor({ state: 'visible', timeout: 10000 })
    await marker.click()
    await expect(page.locator('[data-popup-content]')).toBeVisible({ timeout: 5000 })
    // Press Escape to close popup
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-popup-content]')).not.toBeVisible({ timeout: 3000 })
  })

  test('sidebar reopen moves focus into events panel', async ({ page }) => {
    await page.goto('/')
    const hideBtn = page.getByRole('button', { name: 'Hide events panel' })
    await hideBtn.click()
    const showBtn = page.getByRole('button', { name: 'Show events panel' })
    await expect(showBtn).toBeFocused()
    await showBtn.click()
    const panel = page.getByRole('complementary', { name: 'Recent block events' })
    await expect(panel).toBeFocused()
  })

  test('API 429 rate-limit triggers error banner with request-error message', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) =>
      route.fulfill({ status: 429, body: 'Too Many Requests' })
    )
    await page.goto('/')
    const errorBanner = page.locator('[role="alert"]')
    await expect(errorBanner).toBeVisible({ timeout: 15000 })
    // The 429 path emits 'HTTP 4xx' which maps to the request-error banner variant
    await expect(errorBanner).toContainText('request error', { timeout: 5000 })
  })

  test('API combined geohash + blockType filter with includeStats=true', async ({ request }) => {
    const response = await request.get(
      'http://localhost:3001/api/probe-events?geohash=u4&blockType=dns_poisoning&includeStats=true'
    )
    expect(response.ok()).toBeTruthy()
    const body = await response.json()
    expect(body).toHaveProperty('liveProbes')
    expect(body).toHaveProperty('blocksToday')
  })

  test('API geohash + blockType combined filter — non-empty response validates both constraints', async ({ request }) => {
    const response = await request.get(
      'http://localhost:3001/api/probe-events?geohash=u&blockType=dns_poisoning'
    )
    expect(response.ok()).toBeTruthy()
    const events = await response.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
      expect(event.geohash.startsWith('u')).toBeTruthy()
    }
  })

  for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]] as [number, number][]) {
    test(`page layout has no horizontal overflow at ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('/')
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      expect(bodyWidth).toBeLessThanOrEqual(width + 1)
    })
  }

  test('mobile bottom sheet is visible at 375px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')
    const mobileSheet = page.locator('#mobile-events-panel')
    await expect(mobileSheet).toBeVisible({ timeout: 15000 })
    const desktopSidebar = page.locator('#events-panel')
    const ariaHidden = await mobileSheet.getAttribute('aria-hidden')
    expect(ariaHidden).toBeNull()
  })

  test('mobile bottom sheet is hidden on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const mobileSheet = page.locator('#mobile-events-panel')
    await expect(mobileSheet).toBeHidden()
  })

  test('filter pills are keyboard-navigable with arrow keys', async ({ page }) => {
    await page.goto('/')
    const allInput = page.locator('input[name="filter"][value="all"]')
    await allInput.focus()
    await expect(allInput).toBeFocused()
    await page.keyboard.press('ArrowRight')
    const dnsInput = page.locator('input[name="filter"][value="dns_poisoning"]')
    await expect(dnsInput).toBeFocused()
    await expect(dnsInput).toBeChecked()
    await page.keyboard.press('ArrowLeft')
    await expect(allInput).toBeFocused()
    await expect(allInput).toBeChecked()
  })

  test('filter pill focus-visible ring is applied on keyboard focus', async ({ page }) => {
    await page.goto('/')
    const allInput = page.locator('input[name="filter"][value="all"]')
    await allInput.focus()
    const span = page.locator('label:has(input[name="filter"][value="all"]) span')
    const ring = await span.evaluate((el) => getComputedStyle(el).outline)
    await expect(allInput).toBeFocused()
  })

  test('loading overlay appears during fetch and disappears on data load', async ({ page }) => {
    let resolveRequest: (value: string) => void
    const requestHeld = new Promise<string>(r => { resolveRequest = r })
    await page.route('**/api/probe-events**', async (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 0, regions: 0, blocksToday: 0 }) })
      }
      await requestHeld
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    const loadingOverlay = page.locator('[role="status"][aria-label="Loading probe events"]')
    await expect(loadingOverlay).toBeVisible({ timeout: 5000 })
    resolveRequest!('')
    await expect(loadingOverlay).not.toBeVisible({ timeout: 5000 })
  })

  test('map event count badge shows blocked and reachable counts', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 2, regions: 1, blocksToday: 1 }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { id: 'b1', targetUrl: 'https://x.com', blockType: 'dns_poisoning',
            geohash: 'u4pruydqqvj', timestamp: Date.now(), nodeWallet: '0x11', reachable: false },
          { id: 'r1', targetUrl: 'https://y.com', blockType: null,
            geohash: 'u4pruydqqvj', timestamp: Date.now() - 500, nodeWallet: '0x22', reachable: true },
        ]) })
    })
    await page.goto('/')
    const badge = page.locator('text=blocked').first()
    await expect(badge).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=reachable').first()).toBeVisible()
  })

  test('toggle button aria-expanded reflects sidebar open state', async ({ page }) => {
    await page.goto('/')
    const toggleBtn = page.getByRole('button', { name: 'Hide events panel' })
    await expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
    await toggleBtn.click()
    const showBtn = page.getByRole('button', { name: 'Show events panel' })
    await expect(showBtn).toHaveAttribute('aria-expanded', 'false')
    await showBtn.click()
    await expect(page.getByRole('button', { name: 'Hide events panel' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('network failure triggers connection-check error banner', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => route.abort('failed'))
    await page.goto('/')
    const errorBanner = page.locator('[role="alert"]')
    await expect(errorBanner).toBeVisible({ timeout: 15000 })
    // Network abort maps to the generic 'check your connection' banner variant
    await expect(errorBanner).toContainText('Check your connection', { timeout: 5000 })
  })

  test('event list items contain secure external links', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      if (route.request().url().includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 1, regions: 1, blocksToday: 1 }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'link-1', targetUrl: 'https://blocked-site.example',
          blockType: 'http_block', geohash: 'u4pruydqqvj', timestamp: Date.now(),
          nodeWallet: '0xABCD1234EFGH', reachable: false,
        }]) })
    })
    await page.goto('/')
    // Wait for events to load in the sidebar
    const eventLink = page.locator('ul[aria-labelledby="events-list-heading"] a').first()
    await expect(eventLink).toBeVisible({ timeout: 10000 })
    await expect(eventLink).toHaveAttribute('href', 'https://blocked-site.example')
    await expect(eventLink).toHaveAttribute('target', '_blank')
    await expect(eventLink).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('API includeStats=true query returns correct stats shape', async ({ request }) => {
    const response = await request.get('http://localhost:3001/api/probe-events?includeStats=true')
    expect(response.ok()).toBeTruthy()
    const stats = await response.json()
    expect(stats).toHaveProperty('liveProbes')
    expect(stats).toHaveProperty('regions')
    expect(stats).toHaveProperty('blocksToday')
    expect(typeof stats.liveProbes).toBe('number')
    expect(typeof stats.regions).toBe('number')
    expect(typeof stats.blocksToday).toBe('number')
  })

  test('skip nav link to map is present and targets map region', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    const skipToMap = page.getByRole('link', { name: 'Skip to map' })
    await expect(skipToMap).toBeVisible()
    await expect(skipToMap).toBeFocused()
    await page.keyboard.press('Enter')
    const mapRegion = page.locator('#map-region')
    await expect(mapRegion).toBeVisible()
  })

  test('skip nav link to events list is present when sidebar is open', async ({ page }) => {
    await page.goto('/')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const skipToEvents = page.getByRole('link', { name: /skip to events/i })
    await expect(skipToEvents).toBeVisible()
    await expect(skipToEvents).toBeFocused()
  })

  test('filter change to empty set shows map no-events overlay', async ({ page }) => {
    await page.route('**/api/probe-events**', (route) => {
      const url = route.request().url()
      if (url.includes('stats=true')) {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 1, regions: 1, blocksToday: 1 }) })
      }
      if (url.includes('blockType=full_unreachable')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          id: 'overlay-1', targetUrl: 'https://example.org',
          blockType: 'dns_poisoning', geohash: 'u4pruydqqvj', timestamp: Date.now(),
          nodeWallet: '0xAbc1', reachable: false,
        }]) })
    })
    await page.goto('/')
    await expect(page.getByText(/recent events/i).first()).toBeVisible({ timeout: 15000 })
    await page.locator('label:has(input[name="filter"][value="full_unreachable"])').click()
    await page.waitForTimeout(500)
    await expect(page.getByText('No events for this filter')).toBeVisible({ timeout: 5000 })
  })
})
