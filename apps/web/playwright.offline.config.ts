import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  outputDir: '/tmp/ahead-offline-tests',
  testDir: './e2e',
  testMatch: 'offline.spec.ts',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4489',
    ...devices['Pixel 7'],
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4489 --strictPort',
    url: 'http://127.0.0.1:4489',
    reuseExistingServer: false,
  },
})
