import { test, expect } from '@playwright/test'

const MOCK_EVENT = {
  id: 'e1',
  targetUrl: 'https://twitter.com',
  blockType: 'dns_poisoning',
  geohash: 'u4pruydqqvj',
  timestamp: Date.now() - 120_000,
  nodeWallet: '0xAb12…Cd34',
  reachable: false,
}

const MOCK_TARGETS = {
  targets: [
    'https://twitter.com',
    'https://instagram.com',
    'https://wikipedia.org',
    'https://youtube.com',
    'https://signal.org',
  ],
  hash: 'ede0a8a1e916e10acedbba5993a18bfc32d055162766b8807b429ed650358b17',
}

function mockApis(page: Parameters<typeof test>[1] extends infer T ? T extends { page: infer P } ? P : never : never) {
  return Promise.all([
    page.route('**/api/probe-events**', (route) => {
      const url = route.request().url()
      if (url.includes('includeStats=true')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            events: [MOCK_EVENT],
            liveProbes: 3,
            regions: 2,
            blocksToday: 1,
            volunteerCount: 5,
          }),
        })
      }
      if (url.includes('stats=true')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ liveProbes: 3, regions: 2, blocksToday: 1, volunteerCount: 5 }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([MOCK_EVENT]),
      })
    }),
    page.route('**/api/targets**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_TARGETS),
      })
    ),
  ])
}

test('url health drawer opens from network tab domain row', async ({ page }) => {
  await mockApis(page)
  await page.goto('/')

  // Navigate to Network tab using exact aria-label
  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await page.waitForTimeout(1500)

  // Click the first domain row
  const firstDomain = page.locator('button').filter({ hasText: /twitter|instagram|wikipedia|youtube|signal/i }).first()
  await firstDomain.waitFor({ state: 'visible', timeout: 8000 })
  await firstDomain.click()

  // Drawer should appear
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

  await page.screenshot({ path: '/tmp/url-health-drawer.png', fullPage: false })
})

test('url health drawer opens from activity tab row', async ({ page }) => {
  await mockApis(page)
  await page.goto('/')

  // Navigate to Activity tab using exact aria-label
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await page.waitForTimeout(1500)

  // Activity rows are <li role="button"> elements
  const firstRow = page.locator('[role="button"]').filter({ hasText: /twitter|instagram|wikipedia|youtube|signal/i }).first()
  await firstRow.waitFor({ state: 'visible', timeout: 8000 })
  await firstRow.click()

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

  await page.screenshot({ path: '/tmp/url-health-activity.png', fullPage: false })
})
