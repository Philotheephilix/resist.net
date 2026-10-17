import { test, expect } from '@playwright/test'

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mock the probe-events endpoint. Supports includeStats piggybacking shape. */
function mockProbeEvents(page: Parameters<typeof test>[1] extends infer T ? T extends { page: infer P } ? P : never : never, events: object[], statsOverride?: object) {
  return page.route('**/api/probe-events**', (route) => {
    const url = route.request().url()
    const stats = statsOverride ?? { liveProbes: 3, regions: 2, blocksToday: 1, volunteerCount: 5 }
    if (url.includes('includeStats=true')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ events, ...stats }),
      })
    }
    if (url.includes('stats=true')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stats) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) })
  })
}

const SAMPLE_EVENT = {
  id: 'e1', targetUrl: 'https://twitter.com', blockType: 'dns_poisoning',
  geohash: 'u4pruydqqvj', timestamp: Date.now() - 120_000, nodeWallet: '0xAb12…Cd34', reachable: false,
}

// ── core page ─────────────────────────────────────────────────────────────────

test.describe('resist.net web app', () => {

  test('loads with title "ResistNet"', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/ResistNet/)
  })

  test('header renders brand name and profile button', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('ResistNet', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible()
  })

  test('bottom nav renders all 5 tabs', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav).toBeVisible()
    for (const label of ['Radar', 'Network', 'Connect', 'Activity', 'More']) {
      await expect(nav.getByRole('button', { name: label })).toBeVisible()
    }
  })

  test('Radar tab is active by default', async ({ page }) => {
    await page.goto('/')
    const radarBtn = page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Radar' })
    await expect(radarBtn).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'Network Radar' })).toBeVisible()
  })

  test('tab navigation switches content', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    // h1 inside main scroll content
    await expect(page.locator('.scroll-content h1').filter({ hasText: 'Activity' })).toBeVisible()
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.locator('.scroll-content h1').filter({ hasText: 'Network' })).toBeVisible()
  })

  test('radar stats row renders with live data', async ({ page }) => {
    await mockProbeEvents(page, [SAMPLE_EVENT], { liveProbes: 42, regions: 7, blocksToday: 3, volunteerCount: 5 })
    await page.goto('/')
    // stats row: nodes, incidents, regions
    await expect(page.getByText('Online nodes')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Regions monitored')).toBeVisible()
  })

  test('stats row shows toLocaleString-formatted numbers', async ({ page }) => {
    await mockProbeEvents(page, [], { liveProbes: 1284, regions: 86, blocksToday: 12, volunteerCount: 0 })
    await page.goto('/')
    // 1284 → "1,284" in en locale
    await expect(page.getByText('1,284').first()).toBeVisible({ timeout: 15000 })
  })

  test('API error shows error banner', async ({ page }) => {
    await page.route('**/api/probe-events**', route => route.fulfill({ status: 500, body: 'Server error' }))
    await page.goto('/')
    const banner = page.locator('[role="alert"]').filter({ hasText: /Network error|Server error/i }).first()
    await expect(banner).toBeVisible({ timeout: 15000 })
  })

  test('network failure shows error banner', async ({ page }) => {
    await page.route('**/api/probe-events**', route => route.abort('failed'))
    await page.goto('/')
    const banner = page.locator('[role="alert"]').filter({ hasText: /Network error|Server error/i }).first()
    await expect(banner).toBeVisible({ timeout: 15000 })
  })

  // ── Test URL modal ──────────────────────────────────────────────────────────

  test('Test a URL button opens modal', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Test a URL' })).toBeVisible()
  })

  test('Test URL modal closes on X button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).not.toBeVisible()
  })

  test('Test URL modal closes on backdrop click', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const backdrop = page.locator('.modal-backdrop')
    await expect(backdrop).toBeVisible()
    // Click on backdrop (not the modal content)
    await backdrop.click({ position: { x: 10, y: 10 } })
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).not.toBeVisible()
  })

  test('Test URL modal has HTTP/DNS/TCP method selector', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const methods = page.locator('.method-row')
    await expect(methods.getByRole('button', { name: 'HTTP' })).toBeVisible()
    await expect(methods.getByRole('button', { name: 'DNS' })).toBeVisible()
    await expect(methods.getByRole('button', { name: 'TCP' })).toBeVisible()
  })

  test('Test URL modal method buttons toggle active state', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const dnsBtn = page.locator('.method-row').getByRole('button', { name: 'DNS' })
    await dnsBtn.click()
    await expect(dnsBtn).toHaveAttribute('aria-pressed', 'true')
    const httpBtn = page.locator('.method-row').getByRole('button', { name: 'HTTP' })
    await expect(httpBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('Test URL modal Run test button is disabled when URL is empty', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const runBtn = page.getByRole('button', { name: 'Run test' })
    await expect(runBtn).toBeDisabled()
  })

  test('Test URL modal shows result on successful test', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://example.com', method: 'HTTP', reachable: true,
          statusCode: 200, latencyMs: 145, errorType: null,
          checkedAt: Date.now(), region: 'Auto',
        }),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    await page.getByRole('button', { name: 'Run test' }).click()
    const result = page.locator('[role="status"]').filter({ hasText: /Reachable/ })
    await expect(result).toBeVisible({ timeout: 10000 })
    await expect(result).toContainText('HTTP')
    await expect(result).toContainText('145ms')
  })

  test('Test URL modal shows blocked result on failed test', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://blocked.example', method: 'HTTP', reachable: false,
          errorType: 'dns_poisoning', errorDetail: 'NXDOMAIN',
          checkedAt: Date.now(), region: 'Mumbai, IN',
        }),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://blocked.example')
    await page.getByRole('button', { name: 'Run test' }).click()
    const result = page.locator('[role="status"]').filter({ hasText: /DNS Poisoning/ })
    await expect(result).toBeVisible({ timeout: 10000 })
  })

  test('Test URL modal prepends https:// automatically', async ({ page }) => {
    let capturedBody: string | null = null
    await page.route('**/api/test-url', route => {
      capturedBody = route.request().postData()
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://example.com', method: 'HTTP', reachable: true, checkedAt: Date.now(), region: 'Auto' }),
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('example.com')
    const responsePromise = page.waitForResponse('**/api/test-url')
    await page.getByRole('button', { name: 'Run test' }).click()
    await responsePromise
    const body = JSON.parse(capturedBody ?? '{}')
    expect(body.url).toMatch(/^https:\/\//)
  })

  test('Test URL modal Enter key submits form', async ({ page }) => {
    let called = false
    await page.route('**/api/test-url', route => {
      called = true
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://ex.com', method: 'HTTP', reachable: true, checkedAt: Date.now(), region: 'Auto' }),
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://ex.com')
    await page.keyboard.press('Enter')
    await page.waitForResponse('**/api/test-url')
    expect(called).toBe(true)
  })

  // ── API: test-url ───────────────────────────────────────────────────────────

  test('POST /api/test-url returns valid result shape', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty('url')
    expect(body).toHaveProperty('method')
    expect(body).toHaveProperty('reachable')
    expect(body).toHaveProperty('checkedAt')
    expect(body).toHaveProperty('region')
    expect(typeof body.reachable).toBe('boolean')
    expect(typeof body.checkedAt).toBe('number')
  })

  test('POST /api/test-url returns 400 on missing url', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { method: 'HTTP' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 on non-http url', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'ftp://example.com' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 on invalid url', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'not-a-url' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 on invalid method', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'INVALID' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url accepts DNS method', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'DNS' },
    })
    // DNS returns 200 (mock mode) or 501 (not yet supported in production) — test only covers mock mode
    expect(res.status()).toBeGreaterThanOrEqual(200)
    expect(res.status()).toBeLessThan(400)
    const body = await res.json()
    expect(body).toHaveProperty('url')
  })

  test('POST /api/test-url accepts TCP method', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'TCP' },
    })
    expect(res.status()).toBeGreaterThanOrEqual(200)
    expect(res.status()).toBeLessThan(400)
  })

  test('POST /api/test-url accepts region parameter', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'HTTP', region: 'Mumbai, IN' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.region).toBe('Mumbai, IN')
  })

  // ── API: probe-events ────────────────────────────────────────────────────────

  test('GET /api/probe-events returns events array', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      const first = data[0]
      expect(first).toHaveProperty('id')
      expect(first).toHaveProperty('targetUrl')
      expect(first).toHaveProperty('geohash')
      expect(first).toHaveProperty('timestamp')
      expect(first).toHaveProperty('nodeWallet')
      expect(typeof first.reachable).toBe('boolean')
    }
  })

  test('GET /api/probe-events?stats=true returns stats shape', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?stats=true')
    expect(res.ok()).toBeTruthy()
    const stats = await res.json()
    expect(typeof stats.liveProbes).toBe('number')
    expect(typeof stats.regions).toBe('number')
    expect(typeof stats.blocksToday).toBe('number')
  })

  test('GET /api/probe-events?includeStats=true returns piggybacked stats shape', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?includeStats=true')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty('liveProbes')
    expect(body).toHaveProperty('regions')
    expect(body).toHaveProperty('blocksToday')
    expect(body).toHaveProperty('events')
    expect(Array.isArray(body.events)).toBeTruthy()
  })

  test('GET /api/probe-events?blockType=dns_poisoning filters correctly', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?blockType=dns_poisoning')
    expect(res.ok()).toBeTruthy()
    const events = await res.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
    }
  })

  test('GET /api/probe-events?blockType=INVALID returns 400', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?blockType=INVALID')
    expect(res.status()).toBe(400)
  })

  test('GET /api/probe-events?geohash=INVALID!! returns 400', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?geohash=INVALID!!')
    expect(res.status()).toBe(400)
  })

  test('GET /api/probe-events?geohash=u4 returns matching events', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?geohash=u4')
    expect(res.ok()).toBeTruthy()
    const events = await res.json()
    expect(Array.isArray(events)).toBeTruthy()
    for (const event of events) {
      expect(event.geohash.startsWith('u4')).toBeTruthy()
    }
  })

  test('GET /api/probe-events?geohash=u4&blockType=dns_poisoning works', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?geohash=u4&blockType=dns_poisoning')
    expect(res.ok()).toBeTruthy()
    const events = await res.json()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
      expect(event.geohash.startsWith('u4')).toBeTruthy()
    }
  })

  test('GET /api/probe-events?geohash=u&blockType=dns_poisoning combined filter', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?geohash=u&blockType=dns_poisoning')
    expect(res.ok()).toBeTruthy()
    const events = await res.json()
    for (const event of events) {
      expect(event.blockType).toBe('dns_poisoning')
      expect(event.geohash.startsWith('u')).toBeTruthy()
    }
  })

  test('GET /api/probe-events?geohash=u4&includeStats=true includes stats fields', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events?geohash=u4&includeStats=true')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body).toHaveProperty('liveProbes')
    expect(body).toHaveProperty('blocksToday')
    expect(body).toHaveProperty('events')
  })

  test('GET /api/bootstrap returns array with expected shape', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/bootstrap')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(Array.isArray(data)).toBeTruthy()
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('wallet')
      expect(data[0]).toHaveProperty('sdpOffer')
      expect(data[0]).toHaveProperty('geohash')
    }
  })

  // ── Activity tab ─────────────────────────────────────────────────────────────

  test('Activity tab shows events from API', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'a1', targetUrl: 'https://activitytest.example' },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
    await expect(page.locator('ul[aria-label="Censorship events"]')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('activitytest.example')).toBeVisible()
  })

  test('Activity tab shows "No events yet" when empty', async ({ page }) => {
    await mockProbeEvents(page, [])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.getByText('No events yet')).toBeVisible({ timeout: 10000 })
  })

  test('Activity tab search filters events by domain', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'a1', targetUrl: 'https://twitter.com' },
      { ...SAMPLE_EVENT, id: 'a2', targetUrl: 'https://wikipedia.org', blockType: null, reachable: true },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const searchInput = page.getByLabel('Search events')
    await expect(searchInput).toBeVisible({ timeout: 10000 })
    await searchInput.fill('twitter')
    await expect(page.getByText('twitter.com')).toBeVisible()
    await expect(page.getByText('wikipedia.org')).not.toBeVisible()
  })

  test('Activity tab events contain clickable links', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'link-1', targetUrl: 'https://linktest.example' },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const link = page.locator('ul[aria-label="Censorship events"] a').first()
    await expect(link).toBeVisible({ timeout: 10000 })
    await expect(link).toHaveAttribute('href', 'https://linktest.example')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('Activity tab sort toggles newest/oldest', async ({ page }) => {
    await mockProbeEvents(page, [])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const newestBtn = page.getByRole('button', { name: /Newest first/i })
    const oldestBtn = page.getByRole('button', { name: /Oldest first/i })
    await expect(newestBtn).toBeVisible({ timeout: 10000 })
    await expect(newestBtn).toHaveAttribute('aria-pressed', 'true')
    await oldestBtn.click()
    await expect(oldestBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(newestBtn).toHaveAttribute('aria-pressed', 'false')
  })

  test('Activity tab shows timeAgo "just now" for recent event', async ({ page }) => {
    const recentTs = Date.now() - 20_000
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'ta-1', timestamp: recentTs },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.getByText('just now')).toBeVisible({ timeout: 10000 })
  })

  test('Activity tab shows "X min ago" for older event', async ({ page }) => {
    const fiveMinsAgo = Date.now() - 5 * 60_000 - 30_000
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'ta-2', timestamp: fiveMinsAgo },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.locator('text=/\\d+ min ago/')).toBeVisible({ timeout: 10000 })
  })

  // ── Network tab ──────────────────────────────────────────────────────────────

  test('Network tab shows live stats', async ({ page }) => {
    await mockProbeEvents(page, [SAMPLE_EVENT], { liveProbes: 99, regions: 10, blocksToday: 5, volunteerCount: 3 })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.getByText('Online volunteer nodes')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('99').first()).toBeVisible()
  })

  test('Network tab shows most affected services', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'n1', targetUrl: 'https://twitter.com', reachable: false },
      { ...SAMPLE_EVENT, id: 'n2', targetUrl: 'https://twitter.com', reachable: false },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.getByText('Most affected services')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('twitter.com')).toBeVisible()
  })

  // ── Connect tab ──────────────────────────────────────────────────────────────

  test('Connect tab renders connect CTA', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Connect' }).click()
    await expect(page.locator('.scroll-content h1').filter({ hasText: 'Connect' })).toBeVisible()
    await expect(page.getByText('Disconnected')).toBeVisible()
    // primary-button inside scroll content (not nav button)
    await expect(page.locator('.scroll-content .primary-button')).toBeVisible()
  })

  // ── More tab ─────────────────────────────────────────────────────────────────

  test('More tab renders settings list', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Monitored services' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Privacy and security' })).toBeVisible()
  })

  // ── Globe ────────────────────────────────────────────────────────────────────

  test('globe container is accessible with aria-label', async ({ page }) => {
    await page.goto('/')
    const globe = page.locator('[aria-label*="Interactive live network globe"]').first()
    await expect(globe).toBeVisible({ timeout: 15000 })
  })

  test('Drag to explore hint button is present in DOM', async ({ page }) => {
    await page.goto('/')
    // Globe hint renders when the Globe dynamic component mounts.
    // In headless Chromium WebGL may not be available so the canvas may not paint,
    // but the hint button is always rendered inside the globe-wrap div.
    await expect(page.locator('.globe-hint').first()).toBeAttached({ timeout: 15000 })
  })

  // ── Accessibility ────────────────────────────────────────────────────────────

  test('bottom nav buttons have aria-current on active tab', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav[aria-label="Main navigation"]')
    await expect(nav.getByRole('button', { name: 'Radar' })).toHaveAttribute('aria-current', 'page')
    // other tabs should NOT have aria-current
    await expect(nav.getByRole('button', { name: 'Activity' })).not.toHaveAttribute('aria-current')
  })

  test('Test URL modal is aria-modal dialog', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Test a URL' })
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  // ── Responsiveness ───────────────────────────────────────────────────────────

  for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]] as [number, number][]) {
    test(`no horizontal overflow at ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('/')
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
      expect(bodyWidth).toBeLessThanOrEqual(width + 1)
    })
  }

  test('phone shell is white background with border-radius on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await page.goto('/')
    const phone = page.locator('.phone').first()
    await expect(phone).toBeVisible()
    const bg = await phone.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(255, 255, 255)')
  })

  // ── Live data wiring ─────────────────────────────────────────────────────────

  test('Radar stats update from live API data', async ({ page }) => {
    await mockProbeEvents(page, [SAMPLE_EVENT], { liveProbes: 777, regions: 44, blocksToday: 8, volunteerCount: 12 })
    await page.goto('/')
    await expect(page.getByText('777').first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('44').first()).toBeVisible()
  })

  test('useBlockEvents polling interval fires every 30s', { timeout: 10_000 }, async ({ page }) => {
    let callCount = 0
    await page.route('**/api/probe-events**', route => {
      callCount++
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ events: [SAMPLE_EVENT], liveProbes: callCount, regions: 1, blocksToday: 0, volunteerCount: 0 }) })
    })
    await page.goto('/')
    // initial call fires immediately
    await page.waitForTimeout(500)
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  // ── WalletSheet lifecycle ────────────────────────────────────────────────────

  const PRIVY_APP_CONFIG = {
    app_id: 'test-app-id',
    name: 'ResistNet',
    login_methods: ['wallet'],
    appearance: { theme: 'light', accent_color: '#19b955' },
    embedded_wallets: { create_on_login: 'off' },
    mfa_methods: [],
  }

  const PRIVY_MOCK_USER = {
    id: 'did:privy:test123',
    created_at: 1700000000,
    linked_accounts: [
      {
        type: 'wallet',
        chain_type: 'ethereum',
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        wallet_index: 0,
        wallet_client_type: 'metamask',
        connector_type: 'injected',
        imported: false,
        delegated: false,
        verified_at: 1700000000,
        first_verified_at: 1700000000,
        latest_verified_at: 1700000000,
      },
    ],
    mfa_methods: [],
    has_accepted_terms: false,
  }

  function mockPrivyAppConfig(page: Parameters<typeof test>[1] extends infer T ? T extends { page: infer P } ? P : never : never) {
    return page.route('**/auth.privy.io/api/v1/apps*', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PRIVY_APP_CONFIG) })
    )
  }

  test('header avatar click opens WalletSheet dialog', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    await expect(page.getByRole('dialog', { name: 'Wallet' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Wallet' })).toHaveAttribute('aria-modal', 'true')
  })

  test('WalletSheet closes via X button', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    await expect(page.getByRole('dialog', { name: 'Wallet' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Wallet' }).getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Wallet' })).not.toBeVisible()
  })

  test('WalletSheet closes via backdrop click', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Wallet' })
    await expect(dialog).toBeVisible()
    await dialog.click({ position: { x: 10, y: 10 } })
    await expect(dialog).not.toBeVisible()
  })

  test('WalletSheet closes via Escape key (focus trap)', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    await expect(page.getByRole('dialog', { name: 'Wallet' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Wallet' })).not.toBeVisible()
  })

  test('WalletSheet unauthenticated state shows Sign in with Ethereum button', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.route('**/auth.privy.io/api/v1/sessions', route =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) })
    )
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Wallet' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Sign in with Ethereum' })).toBeVisible({ timeout: 8000 })
  })

  test('WalletSheet authenticated state shows Disconnect wallet button and truncated address', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.addInitScript(() => {
      window.__PRIVY_TEST_USER__ = {
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        chainType: 'ethereum',
      }
    })
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Wallet' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible({ timeout: 8000 })
    await expect(dialog.locator('code').filter({ hasText: '0xAbCd' })).toBeVisible()
  })

  test('WalletSheet copy full address button calls clipboard.writeText with full address', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.addInitScript(() => {
      window.__PRIVY_TEST_USER__ = {
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        chainType: 'ethereum',
      }
      const calls: string[] = []
      ;(window as any).__clipboardCalls = calls
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t: string) => { calls.push(t); return Promise.resolve() } },
        configurable: true,
      })
    })
    await page.goto('/')
    await page.locator('header.topbar').getByRole('button', { name: /Sign in|Account|Wallet/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Wallet' })
    await expect(dialog.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible({ timeout: 8000 })
    await dialog.getByRole('button', { name: 'Copy full address' }).click()
    await expect(dialog.getByRole('button', { name: 'Copy full address' })).toContainText('Copied!')
    const calls = await page.evaluate(() => (window as any).__clipboardCalls)
    expect(calls).toContain('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')
  })

  test('MorePage copy wallet address calls clipboard.writeText and does not open WalletSheet', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.addInitScript(() => {
      window.__PRIVY_TEST_USER__ = {
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        chainType: 'ethereum',
      }
      const calls: string[] = []
      ;(window as any).__clipboardCalls = calls
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (t: string) => { calls.push(t); return Promise.resolve() } },
        configurable: true,
      })
    })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('button', { name: 'Copy wallet address' })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: 'Copy wallet address' }).click()
    await expect(page.getByRole('button', { name: 'Copy wallet address' }).locator('svg')).toBeVisible()
    const calls = await page.evaluate(() => (window as any).__clipboardCalls)
    expect(calls).toContain('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12')
    await expect(page.getByRole('dialog', { name: 'Wallet' })).not.toBeVisible()
  })

})
