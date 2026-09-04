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
