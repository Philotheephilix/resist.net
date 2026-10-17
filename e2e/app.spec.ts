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

  test('Notifications button shows alert with Notifications message', async ({ page }) => {
    await page.goto('/')
    const dialogPromise = page.waitForEvent('dialog', { predicate: d => d.message().includes('Notifications') })
    await page.getByRole('button', { name: 'Notifications' }).click()
    const dialog = await dialogPromise
    await dialog.dismiss()
    expect(dialog.message()).toContain('Notifications')
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

  test('tab switch resets scroll position to zero', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.locator('.scroll-content h1').filter({ hasText: 'Activity' })).toBeVisible()
    await page.locator('.scroll-content').evaluate(el => el.scrollTo({ top: 200 }))
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.locator('.scroll-content h1').filter({ hasText: 'Network' })).toBeVisible()
    const scrollTop = await page.locator('.scroll-content').evaluate(el => el.scrollTop)
    expect(scrollTop).toBe(0)
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

  test('Radar stats row shows skeleton loaders on empty events + null stats cold-start', async ({ page }) => {
    await mockProbeEvents(page, [], { liveProbes: null, regions: null, blocksToday: null, volunteerCount: null })
    await page.goto('/')
    await page.waitForSelector('.big-stat', { timeout: 10000 })
    await expect(page.locator('.big-stat').getByText('0')).not.toBeVisible()
    await expect(page.locator('.big-stat .skeleton').first()).toBeVisible()
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

  test('Test URL modal shows generic Blocked when errorType is null', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://blocked.example', method: 'HTTP', reachable: false,
          errorType: null, checkedAt: Date.now(), region: 'Auto',
        }),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://blocked.example')
    await page.getByRole('button', { name: 'Run test' }).click()
    const result = page.locator('[role="status"]').filter({ hasText: /Blocked/ })
    await expect(result).toBeVisible({ timeout: 10000 })
    await expect(result).not.toContainText('DNS Poisoning')
  })

  test('Test URL modal shows not supported message on 501 response', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 501, contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://example.com', method: 'DNS', reachable: false,
          notSupported: true, errorDetail: 'DNS method not yet implemented',
          checkedAt: Date.now(), region: 'Auto',
        }),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    const dnsBtn = page.locator('.method-row').getByRole('button', { name: 'DNS' })
    await dnsBtn.click()
    await page.getByRole('button', { name: 'Run test' }).click()
    const result = page.locator('[role="status"]').filter({ hasText: /Not yet supported/ })
    await expect(result).toBeVisible({ timeout: 10000 })
  })

  test('Test URL modal shows error alert on non-200 API response', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ error: 'url must use http or https' }),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    await page.getByRole('button', { name: 'Run test' }).click()
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: 10000 })
    await expect(alert).toContainText('url must use http or https')
  })

  test('Test URL modal shows generic error on 500 response', async ({ page }) => {
    await page.route('**/api/test-url', route =>
      route.fulfill({
        status: 500, contentType: 'application/json',
        body: JSON.stringify({}),
      })
    )
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    await page.getByRole('button', { name: 'Run test' }).click()
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: 10000 })
    await expect(alert).not.toBeEmpty()
    await expect(page.getByRole('button', { name: 'Run test' })).not.toHaveAttribute('aria-busy', 'true')
  })

  test('Test URL modal shows error alert on network abort', async ({ page }) => {
    await page.route('**/api/test-url', route => route.abort('timedout'))
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    await page.getByRole('button', { name: 'Run test' }).click()
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: 10000 })
    await expect(alert).not.toBeEmpty()
    await expect(page.getByRole('button', { name: 'Run test' })).not.toHaveAttribute('aria-busy', 'true')
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
    const response = await responsePromise
    const body = JSON.parse(capturedBody ?? '{}')
    expect(body.url).toMatch(/^https:\/\//)
    const responseBody = await response.json()
    expect(responseBody.url).toMatch(/^https:\/\//)
    expect(typeof responseBody.reachable).toBe('boolean')
    expect(response.headers()['cache-control']).toBe('no-store')
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
    await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 5000 })
  })

  test('Test URL modal region selector sends selected region in request body', async ({ page }) => {
    let capturedBody: string | null = null
    await page.route('**/api/test-url', route => {
      capturedBody = route.request().postData()
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ url: 'https://example.com', method: 'HTTP', reachable: true, checkedAt: Date.now(), region: 'Mumbai, IN' }),
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await page.getByLabel('URL to test').fill('https://example.com')
    await page.getByLabel('Select region').selectOption('Mumbai, IN')
    expect(await page.locator('.route-select b').textContent()).toBe('Mumbai, IN')
    await page.getByRole('button', { name: 'Run test' }).click()
    await page.waitForResponse('**/api/test-url')
    const body = JSON.parse(capturedBody ?? '{}')
    expect(body.region).toBe('Mumbai, IN')
    await expect(page.locator('[role="status"]')).toContainText('Mumbai, IN')
  })

  test('Test URL modal sets inert on scroll-content and nav while open, removes it on close', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).toBeVisible()
    expect(await page.locator('.scroll-content').getAttribute('inert')).not.toBeNull()
    expect(await page.locator('nav[aria-label="Main navigation"]').getAttribute('inert')).not.toBeNull()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).not.toBeVisible()
    expect(await page.locator('.scroll-content').getAttribute('inert')).toBeNull()
    expect(await page.locator('nav[aria-label="Main navigation"]').getAttribute('inert')).toBeNull()
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

  test('POST /api/test-url defaults method to HTTP when method is non-string', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 123 },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.method).toBe('HTTP')
  })

  test('POST /api/test-url returns 400 on empty string url', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: '' },
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

  test('POST /api/test-url returns 400 when body is a JSON array', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      headers: { 'content-type': 'application/json' },
      data: '[]',
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 when body is a JSON number', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      headers: { 'content-type': 'application/json' },
      data: '42',
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 when body is a JSON string', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      headers: { 'content-type': 'application/json' },
      data: '"hello"',
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 when body is not valid JSON', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      headers: { 'content-type': 'application/json' },
      data: 'not-json',
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url strips or rejects credentials in URL', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://user:secret@example.com' },
    })
    if (res.ok()) {
      const body = await res.json()
      expect(body.url).not.toContain('secret')
    } else {
      expect(res.status()).toBe(400)
    }
  })

  test('POST /api/test-url normalises whitespace around URL', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: '  https://example.com  ' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.url).toBe('https://example.com/')
  })

  test('POST /api/test-url returns 400 on invalid method', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'INVALID' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url returns 400 when region exceeds 128 characters', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', region: 'A'.repeat(129) },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/test-url rejects hostname that resolves to a private IP (DNS rebinding guard)', async ({ request }) => {
    // "localhost" resolves to 127.0.0.1 via dns.lookup — isPrivateIP must catch it
    // and the response must never come back as reachable: true
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://localhost/', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.reachable).not.toBe(true)
  })

  for (const privateUrl of [
    'http://192.168.1.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/',
    'http://[2002:c0a8:0101::]/',
  ]) {
    test(`POST /api/test-url rejects bare private IP literal ${privateUrl}`, async ({ request }) => {
      const res = await request.post('http://localhost:3001/api/test-url', {
        data: { url: privateUrl, method: 'HTTP' },
      })
      expect(res.ok()).toBeTruthy()
      const body = await res.json()
      expect(body.reachable).not.toBe(true)
    })
  }

  test('POST /api/test-url rejects IPv4-mapped IPv6 address (::ffff: prefix)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://[::ffff:192.168.1.1]/', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.reachable).not.toBe(true)
  })

  test('POST /api/test-url rejects documentation range IPv6 address (2001:db8::)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://[2001:db8::1]/', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.reachable).not.toBe(true)
  })

  test('POST /api/test-url rejects ULA IPv6 address (fc00::)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://[fc00::1]/', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.reachable).not.toBe(true)
  })

  test('POST /api/test-url rejects link-local IPv6 address (fe80::)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'http://[fe80::1]/', method: 'HTTP' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.reachable).not.toBe(true)
  })

  test('POST /api/test-url returns 501 for DNS method (not yet implemented)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'DNS' },
    })
    const body = await res.json()
    expect(res.status()).toBe(501)
    expect(body.notSupported).toBe(true)
    expect(body.reachable).toBeNull()
  })

  test('POST /api/test-url returns 501 for TCP method (not yet implemented)', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'TCP' },
    })
    const body = await res.json()
    expect(res.status()).toBe(501)
    expect(body.notSupported).toBe(true)
    expect(body.reachable).toBeNull()
  })

  test('POST /api/test-url accepts region parameter', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/test-url', {
      data: { url: 'https://example.com', method: 'HTTP', region: 'Mumbai, IN' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.region).toBe('Mumbai, IN')
  })

  test('POST /api/test-url rate-limits to 5 requests per IP and returns 429 with Retry-After on the 6th', async ({ request }) => {
    const spoofedIp = '203.0.113.99'
    let lastRes
    for (let i = 0; i < 6; i++) {
      lastRes = await request.post('http://localhost:3001/api/test-url', {
        data: { url: 'https://example.com' },
        headers: { 'x-forwarded-for': spoofedIp },
      })
      if (i < 5) expect(lastRes.status()).not.toBe(429)
    }
    expect(lastRes!.status()).toBe(429)
    expect(lastRes!.headers()['retry-after']).toBe('60')
  })

  // ── API: probe-events ────────────────────────────────────────────────────────

  test('GET /api/probe-events returns events array', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/probe-events')
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(Array.isArray(data)).toBeTruthy()
    expect(data.length).toBeGreaterThan(0)
    const first = data[0]
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('targetUrl')
    expect(first).toHaveProperty('geohash')
    expect(first).toHaveProperty('timestamp')
    expect(first).toHaveProperty('nodeWallet')
    expect(typeof first.reachable).toBe('boolean')
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

  test('POST /api/probe-events returns 405 Method Not Allowed', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/probe-events')
    expect(res.status()).toBe(405)
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
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('wallet')
    expect(data[0]).toHaveProperty('sdpOffer')
    expect(data[0]).toHaveProperty('geohash')
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
    await searchInput.fill('')
    await expect(page.getByText('twitter.com')).toBeVisible()
    await expect(page.getByText('wikipedia.org')).toBeVisible()
  })

  test('Activity tab search shows "No events match this search" for no-match query', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'a1', targetUrl: 'https://twitter.com' },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const searchInput = page.getByLabel('Search events')
    await expect(searchInput).toBeVisible({ timeout: 10000 })
    await searchInput.fill('xyzzy')
    await expect(page.getByText('No events match this search')).toBeVisible()
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
    const newerTs = Date.now() - 60_000
    const olderTs = Date.now() - 3600_000
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'sort-new', targetUrl: 'https://newer.example', timestamp: newerTs },
      { ...SAMPLE_EVENT, id: 'sort-old', targetUrl: 'https://older.example', timestamp: olderTs },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const newestBtn = page.getByRole('button', { name: /Newest first/i })
    const oldestBtn = page.getByRole('button', { name: /Oldest first/i })
    await expect(newestBtn).toBeVisible({ timeout: 10000 })
    await expect(newestBtn).toHaveAttribute('aria-pressed', 'true')
    const firstItem = page.locator('ul[aria-label="Censorship events"] li').first()
    await expect(firstItem).toContainText('newer.example')
    await oldestBtn.click()
    await expect(oldestBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(newestBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(firstItem).toContainText('older.example')
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

  test('Activity tab error+retry path fires a second fetch on tap', async ({ page }) => {
    let callCount = 0
    await page.route('**/api/probe-events**', (route) => {
      callCount++
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const retryLink = page.getByText('tap to retry')
    await expect(retryLink).toBeVisible({ timeout: 10000 })
    const countBefore = callCount
    await retryLink.click()
    await expect.poll(() => callCount, { timeout: 5000 }).toBeGreaterThan(countBefore)
  })

  test('Activity tab pagination Load more button appears and loads remaining events', async ({ page }) => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      ...SAMPLE_EVENT,
      id: `pg-${i}`,
      targetUrl: `https://host${i}.example`,
    }))
    await mockProbeEvents(page, events)
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    await expect(page.locator('ul[aria-label="Censorship events"]')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Load more/)).toBeVisible()
    await page.getByText(/Load more/).click()
    for (let i = 0; i < 60; i++) {
      await expect(page.getByText(`host${i}.example`)).toBeVisible()
    }
  })

  test('Activity tab aria-live region updates on search', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'live-1', targetUrl: 'https://twitter.com' },
      { ...SAMPLE_EVENT, id: 'live-2', targetUrl: 'https://wikipedia.org', blockType: null, reachable: true },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const liveRegion = page.locator('div[aria-live="polite"]')
    const searchInput = page.getByLabel('Search events')
    await expect(searchInput).toBeVisible({ timeout: 10000 })
    await searchInput.fill('twitter')
    await expect(liveRegion).toContainText(/\d+ result/)
    await searchInput.fill('xyzzy')
    await expect(liveRegion).toContainText('No events match this search')
  })

  test('Activity tab each event link shows its own hostname independently', async ({ page }) => {
    await mockProbeEvents(page, [
      { ...SAMPLE_EVENT, id: 'host-1', targetUrl: 'https://alpha.example' },
      { ...SAMPLE_EVENT, id: 'host-2', targetUrl: 'https://beta.example' },
    ])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Activity' }).click()
    const links = page.locator('ul[aria-label="Censorship events"] a')
    await expect(links).toHaveCount(2, { timeout: 10000 })
    const hrefs = await links.evaluateAll((els: HTMLAnchorElement[]) => els.map(a => a.href))
    expect(hrefs).toContain('https://alpha.example/')
    expect(hrefs).toContain('https://beta.example/')
    const texts = await links.evaluateAll((els: HTMLElement[]) => els.map(a => a.textContent?.trim()))
    expect(texts).toContain('alpha.example')
    expect(texts).toContain('beta.example')
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

  test('Network tab shows empty state when no events', async ({ page }) => {
    await mockProbeEvents(page, [])
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.getByText('No network events recorded yet')).toBeVisible({ timeout: 10000 })
  })

  test('Network tab health row Confirmed incidents is red when blocksToday > 0', async ({ page }) => {
    await mockProbeEvents(page, [SAMPLE_EVENT], { liveProbes: 3, regions: 2, blocksToday: 4, volunteerCount: 5 })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await expect(page.getByText('Confirmed incidents')).toBeVisible({ timeout: 10000 })
    const valueCell = page.locator('.health-row').filter({ hasText: 'Confirmed incidents' }).locator('b')
    await expect(valueCell).toHaveClass(/red/)
  })

  test('Network tab shows skeleton loaders instead of zeros on stats cache cold-start', async ({ page }) => {
    await mockProbeEvents(page, [], { liveProbes: 0, regions: 0, blocksToday: 0, volunteerCount: 0 })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    await page.waitForSelector('.big-stat', { timeout: 10000 })
    await expect(page.locator('.big-stat').getByText('0')).not.toBeVisible()
    await expect(page.locator('.big-stat .skeleton').first()).toBeVisible()
  })

  test('Network tab error+retry path fires a second fetch on tap', async ({ page }) => {
    let callCount = 0
    await page.route('**/api/probe-events**', (route) => {
      callCount++
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Network' }).click()
    const retryLink = page.getByText('tap to retry')
    await expect(retryLink).toBeVisible({ timeout: 10000 })
    const countBefore = callCount
    await retryLink.click()
    await expect.poll(() => callCount, { timeout: 5000 }).toBeGreaterThan(countBefore)
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

  test('Connect tab renders quick-action buttons', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Connect' }).click()
    await expect(page.locator('.scroll-content .quick-actions').getByText('Choose region')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.scroll-content .quick-actions').getByText('Find best route')).toBeVisible()
    await expect(page.locator('.scroll-content .quick-actions').getByText('More options')).toBeVisible()
  })

  test('Connect tab Choose region button cycles route label', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Connect' }).click()
    const routeLabel = page.locator('.route-select b')
    await expect(routeLabel).toBeVisible({ timeout: 10000 })
    const initialText = await routeLabel.textContent()
    await page.locator('.scroll-content .quick-actions').getByText('Choose region').click()
    await expect(routeLabel).not.toHaveText(initialText!)
  })

  test('Connect tab Connect button opens WalletSheet dialog', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Connect' }).click()
    await page.locator('.scroll-content .primary-button').click()
    const dialog = page.locator('[role="dialog"][aria-modal="true"]')
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await expect(dialog.locator('#wallet-modal-title')).toHaveText('Connect wallet')
    expect(await dialog.getAttribute('aria-labelledby')).toBe('wallet-modal-title')
  })

  test('Connect tab: closing WalletSheet after authentication shows Connected state', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.addInitScript(() => {
      window.__PRIVY_TEST_USER__ = {
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        chainType: 'ethereum',
      }
    })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'Connect' }).click()
    await page.locator('.scroll-content .primary-button').click()
    const dialog = page.getByRole('dialog', { name: 'Wallet' })
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.connect-card')).toContainText('Connected', { timeout: 8000 })
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

  test('More tab profile card click opens WalletSheet', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible()
    const profileCard = page.locator('.profile-card[role="button"]')
    await expect(profileCard).toBeVisible()
    await profileCard.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
  })

  test('More tab unauthenticated state shows Sign in with Ethereum button', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('button', { name: 'Sign in with Ethereum' })).toBeVisible({ timeout: 10000 })
  })

  test('More tab settings button shows coming soon toast then hides after 2.5 s', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('heading', { name: 'More' })).toBeVisible()
    await page.getByRole('button', { name: 'Monitored services' }).click()
    const toast = page.locator('[role="status"]').filter({ hasText: 'Monitored services' })
    await expect(toast).toBeVisible({ timeout: 3000 })
    await page.waitForTimeout(2700)
    await expect(toast).not.toBeVisible()
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

  test('Globe hint button aria-label toggles between pause and resume on click', async ({ page }) => {
    await page.goto('/')
    const btn = page.locator('.globe-hint').first()
    await expect(btn).toBeAttached({ timeout: 15000 })
    await expect(btn).toHaveAttribute('aria-label', 'Pause globe rotation')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-label', 'Resume globe rotation')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-label', 'Pause globe rotation')
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

  test('Test URL modal focus trap keeps Tab cycling within the dialog', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    const dialog = page.getByRole('dialog', { name: 'Test a URL' })
    await expect(dialog).toBeVisible()
    const dialogEl = await dialog.elementHandle()
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(
        (d) => d!.contains(document.activeElement),
        dialogEl,
      )
      expect(inside).toBe(true)
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab')
      const inside = await page.evaluate(
        (d) => d!.contains(document.activeElement),
        dialogEl,
      )
      expect(inside).toBe(true)
    }
  })

  test('Test URL modal Escape returns focus to trigger button', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Test a URL/i }).click()
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Test a URL' })).not.toBeVisible()
    const activeLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    expect(activeLabel).toBe('Test a URL')
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

  test('useBlockEvents fires initial fetch on mount', { timeout: 10_000 }, async ({ page }) => {
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

  test('useBlockEvents resumes polling after tab becomes visible', { timeout: 10_000 }, async ({ page }) => {
    let callCount = 0
    await page.route('**/api/probe-events**', route => {
      callCount++
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ events: [SAMPLE_EVENT], liveProbes: callCount, regions: 1, blocksToday: 0, volunteerCount: 0 }) })
    })
    await page.goto('/')
    await page.waitForTimeout(300)
    const afterInitial = callCount
    expect(afterInitial).toBeGreaterThanOrEqual(1)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(1500)
    const afterHide = callCount
    expect(afterHide).toBeLessThanOrEqual(afterInitial + 1)

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(500)
    expect(callCount).toBeGreaterThan(afterHide)
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

  test('WalletSheet Disconnect wallet closes sheet and reverts to unauthenticated state', async ({ page }) => {
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
    await expect(dialog.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible({ timeout: 8000 })
    await page.addInitScript(() => {
      delete (window as any).__PRIVY_TEST_USER__
    })
    await dialog.getByRole('button', { name: 'Disconnect wallet' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('header.topbar').getByRole('button', { name: /Sign in/i })).toBeVisible({ timeout: 8000 })
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
    await page.waitForTimeout(1700)
    await expect(dialog.getByRole('button', { name: 'Copy full address' })).not.toContainText('Copied!')
    await expect(dialog.getByRole('button', { name: 'Copy full address' })).toContainText('0xAbCd')
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

  test('MorePage Disconnect wallet button triggers logout and reverts to unauthenticated state', async ({ page }) => {
    await mockPrivyAppConfig(page)
    await page.addInitScript(() => {
      window.__PRIVY_TEST_USER__ = {
        address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        chainType: 'ethereum',
      }
    })
    await page.goto('/')
    await page.locator('nav[aria-label="Main navigation"]').getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible({ timeout: 8000 })
    await page.getByRole('button', { name: 'Disconnect wallet' }).click()
    await expect(page.getByRole('button', { name: 'Sign in with Ethereum' })).toBeVisible({ timeout: 8000 })
  })

})
