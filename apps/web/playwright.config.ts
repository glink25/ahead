import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4466', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], locale: 'zh-CN', reducedMotion: 'reduce' } },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'zh-CN', reducedMotion: 'reduce' } },
  ],
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 4466 --strictPort', url: 'http://127.0.0.1:4466', reuseExistingServer: !process.env.CI },
})
