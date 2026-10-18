import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'en-US',
  },
  webServer: {
    command: 'cd apps/web && next dev -p 3000',
    url: 'http://localhost:3000',
    timeout: 60_000,
    reuseExistingServer: !process.env['CI'],
    env: {
      NODE_ENV: 'development',
      USE_MOCK_DATA: '',
      NEXT_PUBLIC_E2E: 'true',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
