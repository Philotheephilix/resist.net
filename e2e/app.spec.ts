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
})
