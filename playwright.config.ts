import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'cd apps/web && next dev -p 3001',
    url: 'http://localhost:3001',
    timeout: 60_000,
    reuseExistingServer: !process.env['CI'],
    env: {
      NODE_ENV: 'development',
      USE_MOCK_DATA: 'true',
      NEXT_PUBLIC_PRIVY_APP_ID: 'cmvbxryi5000x0ekuvsmxk2s5',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
