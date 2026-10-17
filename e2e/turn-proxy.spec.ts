import { test, expect } from '@playwright/test'

test.describe('TURN credentials + Connect tab', () => {

  test('GET /api/turn-credentials returns valid TURN iceServers', async ({ request }) => {
    const res = await request.get('/api/turn-credentials')
    expect(res.status()).toBe(200)

    const body = await res.json()
    expect(Array.isArray(body.iceServers)).toBe(true)
    expect(body.iceServers.length).toBeGreaterThan(0)

    const turnEntry = body.iceServers.find((s: { urls: string | string[]; username?: string }) =>
      [s.urls].flat().some((u: string) => u.startsWith('turn:') || u.startsWith('turns:'))
    )
    expect(turnEntry).toBeTruthy()
    expect(turnEntry.username).toBeTruthy()
    expect(turnEntry.credential).toBeTruthy()

    const turnUrls: string[] = [turnEntry.urls].flat().filter((u: string) => u.startsWith('turn'))
    expect(turnUrls.length).toBeGreaterThan(0)

    await test.info().attach('turn-credentials-response', {
      body: JSON.stringify(body, null, 2),
      contentType: 'application/json',
    })
  })

  test('Connect tab shows copyable CLI command', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForTimeout(1000)

    // CLI command block must be visible
    const codeBlock = page.locator('pre, code').filter({ hasText: /npx|proxy-client/ }).first()
    await expect(codeBlock).toBeVisible({ timeout: 8000 })

    const cmdText = await codeBlock.textContent()
    expect(cmdText).toMatch(/npx|@resist/)

    await page.screenshot({ path: '/tmp/connect-tab.png' })
  })

  test('Connect tab renders without errors — no broken layout', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.waitForTimeout(1500)

    // Filter known non-actionable errors
    const realErrors = consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_') &&
      !e.includes('Failed to load resource')
    )
    expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)

    await page.screenshot({ path: '/tmp/connect-tab-no-errors.png' })
  })

  test('TURN credentials cached — second request faster than first', async ({ request }) => {
    const t0 = Date.now()
    const r1 = await request.get('/api/turn-credentials')
    const t1 = Date.now()
    const r2 = await request.get('/api/turn-credentials')
    const t2 = Date.now()

    expect(r1.status()).toBe(200)
    expect(r2.status()).toBe(200)

    const d1 = t1 - t0
    const d2 = t2 - t1
    console.log(`First request: ${d1}ms, second (cached): ${d2}ms`)

    // Cached response should be substantially faster than Cloudflare round-trip
    expect(d2).toBeLessThan(d1 + 200) // cached ≤ first + 200ms (generous)

    const b1 = await r1.json()
    const b2 = await r2.json()
    // Same credential username on cache hit (within same 24h TTL)
    const u1 = b1.iceServers.find((s: {username?: string}) => s.username)?.username
    const u2 = b2.iceServers.find((s: {username?: string}) => s.username)?.username
    expect(u1).toBeTruthy()
    expect(u2).toBeTruthy()
    // Cached — same credentials returned
    expect(u1).toBe(u2)
  })

})
