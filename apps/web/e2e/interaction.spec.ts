import { test, expect, type Page } from '@playwright/test'

async function offlineMarket(page: Page) {
  await page.route('https://api.github.com/**', (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route('https://cdn.jsdelivr.net/**', (route) =>
    route.fulfill({ status: 404, body: '' }),
  )
}
test.beforeEach(async ({ page }) => offlineMarket(page))

test('nested app back pops browser history, including after refresh', async ({
  page,
}) => {
  await page.goto('/mine?view=calendar')
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByText('诊断信息', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: '实验性设置', exact: true }).click()
  await expect(page.getByText('诊断信息', { exact: true })).toBeVisible()
  const length = await page.evaluate(() => history.length)
  await page.reload()
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  expect(await page.evaluate(() => history.length)).toBe(length)
  await page.goBack()
  await expect(page).toHaveURL(/\/mine\?view=calendar$/)
  await page.goForward()
  await expect(page).toHaveURL(/\/settings$/)
})

test('direct entry has a parent fallback and old diagnostic links migrate', async ({
  page,
}) => {
  await page.goto('/settings/experimental')
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await page.goto('/settings#diagnostics')
  await expect(page).toHaveURL(/\/settings\/experimental#diagnostics$/)
  await expect(page.locator('#diagnostics')).toHaveAttribute('open', '')
})

test('unsaved editor blocks app back and browser back, then resumes the original pop', async ({
  page,
}) => {
  await page.goto('/mine')
  await page.getByRole('link', { name: '新建事件', exact: true }).last().click()
  await page.getByPlaceholder('有什么值得期待？').fill('不要丢失')
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page.getByRole('dialog', { name: '未保存的事件' })).toBeVisible()
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(page).toHaveURL(/\/studio$/)
  await page.goBack()
  await expect(page.getByRole('dialog', { name: '未保存的事件' })).toBeVisible()
  await page.getByRole('button', { name: '保存并离开' }).click()
  await expect(page).toHaveURL(/\/mine$/)
  await expect(page.locator('.timeline-row')).toContainText('不要丢失')
})

test('undo expires, clears its snapshot, and does not return after reload', async ({
  page,
}) => {
  await page.goto('/settings')
  await page.getByRole('switch', { name: '加载外部图片' }).click()
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toBeVisible()
  // Keep the pointer off the toast; Sonner pauses its countdown during interaction.
  await page.mouse.move(0, 0)
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toHaveCount(0, { timeout: 8000 })
  expect(
    await page.evaluate(
      async () =>
        (await import('/src/stores/feed.ts' as string)).useFeedStore.getState()
          .undoOperation,
    ),
  ).toBeUndefined()
  await page.reload()
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('switch', { name: '加载外部图片' }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(
    page.getByRole('switch', { name: '加载外部图片' }),
  ).not.toBeChecked()
})

test('full reset requires confirmation and clears old databases, storage, caches and sibling tabs', async ({
  page,
  context,
}) => {
  await page.goto('/settings/experimental')
  await page.evaluate(async () => {
    localStorage.setItem('reset-test', 'private')
    sessionStorage.setItem('reset-test', 'private')
    await (
      await caches.open('old-cache')
    ).put('/old-private', new Response('private'))
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('old-account-db', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('data')
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })
  })
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: '清空数据', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('reset-test'))).toBe(
    'private',
  )
  const sibling = await context.newPage()
  await offlineMarket(sibling)
  await sibling.goto('/studio')
  await sibling
    .getByPlaceholder('有什么值得期待？')
    .fill('另一个标签页的未保存内容')
  await sibling.evaluate(() =>
    sessionStorage.setItem('reset-test', 'sibling-private'),
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清空数据', exact: true }).click()
  await expect(page).toHaveURL(/\/discover$/, { timeout: 15000 })
  const remaining = await page.evaluate(async () => ({
    local: localStorage.getItem('reset-test'),
    session: sessionStorage.getItem('reset-test'),
    cache: await caches.has('old-cache'),
    databases: (await indexedDB.databases()).map((db) => db.name),
  }))
  expect(remaining.local).toBeNull()
  expect(remaining.session).toBeNull()
  expect(remaining.cache).toBe(false)
  expect(remaining.databases).not.toContain('old-account-db')
  await expect(sibling).toHaveURL(/\/reset.html\?peer=1$/)
  expect(
    await sibling.evaluate(() => sessionStorage.getItem('reset-test')),
  ).toBeNull()
  await expect(
    sibling.getByRole('button', { name: '重新打开应用' }),
  ).toBeVisible()
})

test('a newer undo replaces the old one and swipe dismissal expires it', async ({
  page,
}) => {
  await page.goto('/settings')
  const setting = page.getByRole('switch', { name: '加载外部图片' })
  await setting.click()
  await expect(setting).not.toBeChecked()
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toBeVisible()
  await setting.click()
  await expect(setting).toBeChecked()
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(setting).not.toBeChecked()
  await setting.click()
  const toast = page.locator('[data-sonner-toast][data-front="true"]')
  await expect(toast.getByRole('button', { name: '关闭提示' })).toHaveCount(0)
  const box = await toast.boundingBox()
  if (!box) throw new Error('Undo toast has no bounding box')
  await page.mouse.move(box.x + box.width / 2, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 70, {
    steps: 4,
  })
  await page.mouse.up()
  await expect(
    page.getByRole('button', { name: '撤销', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      async () =>
        (await import('/src/stores/feed.ts' as string)).useFeedStore.getState()
          .undoOperation,
    ),
  ).toBeUndefined()
})

test('failed cache clearing stays on reset and can be retried', async ({
  page,
}) => {
  await page.goto('/settings/experimental')
  await page.route('**/clear-site-data.txt?**', (route) =>
    route.fulfill({ status: 503, body: 'temporarily unavailable' }),
  )
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清空数据', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('清理未完成')
  await expect(page.getByRole('button', { name: '重新打开应用' })).toBeHidden()
  await page.unroute('**/clear-site-data.txt?**')
  await page.getByRole('button', { name: '重试清理' }).click()
  await expect(page).toHaveURL(/\/discover$/)
})

test('blocked legacy database reports failure and retry completes after closing the connection', async ({
  page,
  context,
}) => {
  const oldTab = await context.newPage()
  await oldTab.goto('/clear-site-data.txt')
  await oldTab.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('legacy-open-db', 1)
      request.onsuccess = () => {
        // Simulate an old app that cannot receive the new reset broadcast.
        ;(window as unknown as { legacy: IDBDatabase }).legacy = request.result
        resolve()
      }
    })
  })
  await page.goto('/settings/experimental')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '清空数据', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('占用数据库', {
    timeout: 12000,
  })
  await oldTab.close()
  await page.getByRole('button', { name: '重试清理' }).click()
  await expect(page).toHaveURL(/\/discover$/)
})
