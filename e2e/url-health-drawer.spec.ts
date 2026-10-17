import { test, expect } from '@playwright/test'

test('url health drawer opens from network tab domain row', async ({ page }) => {
  await page.goto('/')

  // Navigate to Network tab using exact aria-label
  await page.getByRole('button', { name: 'Network', exact: true }).click()
  await page.waitForTimeout(1500)

  // Click the first domain row
  const firstDomain = page.locator('button').filter({ hasText: /twitter|instagram|wikipedia|youtube|reddit/i }).first()
  await firstDomain.waitFor({ state: 'visible', timeout: 8000 })
  await firstDomain.click()

  // Drawer should appear
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

  await page.screenshot({ path: '/tmp/url-health-drawer.png', fullPage: false })
})

test('url health drawer opens from activity tab row', async ({ page }) => {
  await page.goto('/')

  // Navigate to Activity tab using exact aria-label
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await page.waitForTimeout(1500)

  // Activity rows are <li role="button"> elements
  const firstRow = page.locator('[role="button"]').filter({ hasText: /twitter|instagram|wikipedia|youtube|reddit/i }).first()
  await firstRow.waitFor({ state: 'visible', timeout: 8000 })
  await firstRow.click()

  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })

  await page.screenshot({ path: '/tmp/url-health-activity.png', fullPage: false })
})
