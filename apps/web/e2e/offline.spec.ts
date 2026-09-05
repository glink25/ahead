import { test, expect } from '@playwright/test'
test.skip(
  !process.env.AHEAD_OFFLINE_TEST,
  'Requires the production service worker build',
)
test('production app reopens offline and saves a personal event', async ({
  page,
  context,
}) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.goto('/mine')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('link', { name: '新建事件', exact: true }).last().click()
  await page.getByPlaceholder('有什么值得期待？').fill('断网后创建')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '断网后创建', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '断网后创建', exact: true }),
  ).toBeVisible()
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible()
})

test('production reset clears service worker caches before starting fresh', async ({
  page,
  context,
}) => {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.goto('/settings/experimental')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  const oldCaches = await page.evaluate(() => caches.keys())
  expect(oldCaches.length).toBeGreaterThan(0)
  await page.evaluate(async () => {
    await (
      await caches.open('old-private-cache')
    ).put('/private', new Response('old'))
  })
  // Inspect the empty origin before the new app is allowed to create fresh caches.
  await page.route('**/discover', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<h1>重置完成</h1>',
    }),
  )
  await context.setOffline(true)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清空数据', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('清理未完成')
  await context.setOffline(false)
  await page.getByRole('button', { name: '重试清理' }).click()
  await expect(page.getByRole('heading', { name: '重置完成' })).toBeVisible()
  expect(await page.evaluate(() => caches.keys())).toEqual([])
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0)
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([])
})

test('only caches selected languages and supports cached offline switching', async ({ page, context }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }))
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  const cachedPaths = () => page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('ahead-shell-'))
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname)))).flat()
  })
  await expect.poll(cachedPaths).toContain('/reset-locales/zh-CN.js')
  const paths = await cachedPaths()
  const languageAssets = await page.evaluate(async () => {
    const source = await (await fetch('/sw.js')).text()
    const match = source.match(/const LANGUAGES = (\{[^;]+\});/)
    return JSON.parse(match?.[1] ?? '{}') as Record<string, string[]>
  })
  expect(paths.some((path) => languageAssets.en?.includes(path))).toBe(false)
  expect(paths).not.toContain('/reset-locales/en.js')
  await context.setOffline(true)
  await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await context.setOffline(false)
  await page.getByRole('combobox', { name: '语言', exact: true }).selectOption('en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await page.goto('/mine')
  await expect(page.getByRole('heading', { name: 'Nothing planned yet', exact: true })).toBeVisible()
  await expect.poll(cachedPaths).toEqual(expect.arrayContaining(languageAssets.en.filter((path) => /mine-/.test(path))))
  await expect.poll(cachedPaths).toContain('/reset-locales/en.js')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Nothing planned yet', exact: true })).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN')
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
})
