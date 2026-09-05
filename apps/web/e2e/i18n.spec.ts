import { expect, test } from '@playwright/test'

test.use({ locale: 'en-US' })
test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }))
})
test('mounts the app shell immediately while a first page namespace loads', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/locales/en/profiles.json', async (route) => {
    if (new URL(route.request().url()).search) return route.continue()
    await gate
    await route.continue()
  })
  await page.goto('/profiles', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('.page-skeleton')).toBeVisible()
  await expect(page.getByText(/Loading…|正在加载…|Restoring account|正在恢复账户/)).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('settings-skeleton.png'), fullPage: true })
  release()
  await expect(page.getByRole('heading', { name: 'Profiles', exact: true })).toBeVisible()
})
test('uses browser language, switches immediately, persists, and returns to browser mode', async ({ page }) => {
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  // Vite's development server resolves both asset URL imports, but must not fetch
  // the unselected catalog itself. The production-cache test checks built assets.
  expect(requested.some((value) => {
    const url = new URL(value)
    return /locales\/zh-CN\.json$/.test(url.pathname) && !url.search
  })).toBe(false)
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.reload()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('auto')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('ahead-language'))).toBeNull()
  await page.screenshot({ path: test.info().outputPath('settings-en.png'), fullPage: true })
})
test('creates and edits English content and displays localized calendar controls', async ({ page }) => {
  await page.goto('/studio')
  await page.getByRole('textbox', { name: 'Event name', exact: true }).fill('English event')
  await page.getByText('Notes', { exact: true }).click()
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('English notes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'English event', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced editor', exact: true }).click()
  const yaml = await page.getByRole('textbox', { name: 'Event YAML', exact: true }).inputValue()
  expect(yaml).toMatch(/en: English event/)
  expect(yaml).toMatch(/en: English notes/)
  expect(yaml).not.toContain('zh-CN:')
  await page.goto('/mine?view=calendar&scale=week&date=2027-01-10')
  await expect(page.getByRole('heading', { name: 'January 2027', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('calendar-en.png'), fullPage: true })
})
