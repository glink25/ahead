import { test, expect } from '@playwright/test'

test('market shows a completed source before a slow sibling and resumes paging after leaving discovery', async ({
  page,
}) => {
  let release!: () => void
  const slow = new Promise<void>((resolve) => {
    release = resolve
  })
  const pages: number[] = []
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const listing = (id: string, number: number) => ({
    number,
    title: id,
    html_url: `https://github.com/test/registry/issues/${number}`,
    labels: [{ name: 'approved' }],
    body:
      '<!-- ahead:source:' +
      JSON.stringify({
        schema: 1,
        resourceType: 'event-feed',
        locator: 'github:test/feeds',
        manifestPath: id + '.yaml',
      }) +
      ' -->',
  })
  await page.route('https://api.github.com/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/issues')) {
      const number = Number(url.searchParams.get('page'))
      pages.push(number)
      return route.fulfill({
        json:
          number === 1
            ? [listing('first', 1), listing('slow', 2)]
            : [listing('last', 3)],
        headers:
          number === 1
            ? {
                link: '<https://api.github.com/next>; rel="next"',
                'access-control-expose-headers': 'link',
              }
            : {},
      })
    }
    return route.fulfill({
      json: url.pathname.includes('/commits/')
        ? { sha: 'a'.repeat(40) }
        : { private: false, default_branch: 'main' },
    })
  })
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const id = route.request().url().split('/').at(-1)!.replace('.yaml', '')
    if (id === 'slow') await slow
    await route
      .fulfill({
        json: {
          oefVersion: '0.1',
          kind: 'event-feed',
          id,
          name: { 'zh-CN': id },
          events: [
            {
              id,
              title: { 'zh-CN': id },
              schedule: [
                {
                  id: 's',
                  recordedAt: '2026-01-01T00:00:00Z',
                  confidence: 'confirmed',
                  value: { kind: 'exact', date: '2030-01-01' },
                },
              ],
            },
          ],
        },
      })
      .catch(() => {})
  })
  await page.goto('/discover')
  await expect(page.locator('[data-index="0"] h1')).toHaveText('first')
  expect(pages).toEqual([1])
  await page.getByRole('link', { name: '我的', exact: true }).click()
  release()
  await expect(page).toHaveURL(/\/mine$/)
  expect(pages).toEqual([1])
  await page.getByRole('link', { name: '发现', exact: true }).click()
  await expect.poll(() => pages).toEqual([1, 2])
  await expect(page.locator('.market-progress')).toHaveCount(0)
  expect(pages).toEqual([1, 2])
  await expect(page.locator('[data-index="0"] h1')).toHaveText('first')
  expect(errors).toEqual([])
})

test('guest quota errors are visible and offer login without repeated metadata calls', async ({
  page,
}) => {
  let calls = 0
  await page.route('https://api.github.com/**', (route) => {
    calls++
    return route.fulfill({
      status: 403,
      json: { message: 'API rate limit exceeded' },
      headers: {
        'x-ratelimit-remaining': '0',
        'access-control-expose-headers': 'x-ratelimit-remaining',
      },
    })
  })
  await page.goto('/discover')
  await expect(page.locator('.error-strip')).toContainText('登录可提高请求额度')
  await expect(
    page.locator('.error-strip').getByRole('link', { name: '登录 GitHub' }),
  ).toHaveAttribute('href', '/login')
  await page
    .locator('.error-strip')
    .getByRole('button', { name: '重试' })
    .click()
  await expect(page.getByRole('heading', { name: '暂时无法加载内容' })).toBeVisible()
  expect(calls).toBe(1)
})
