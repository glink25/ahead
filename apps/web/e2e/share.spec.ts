import { expect, test } from '@playwright/test'

const sha = 'd'.repeat(40)
const feed = {
  oefVersion: '0.1',
  kind: 'event-feed',
  id: 'launches',
  name: { 'zh-CN': '发售频道' },
  description: { 'zh-CN': '值得期待的新作' },
  events: [{
    id: 'new-game',
    title: { 'zh-CN': '新游戏' },
    summary: { 'zh-CN': '一场新的冒险' },
    schedule: [{
      id: 'announced',
      recordedAt: '2026-01-01T00:00:00Z',
      value: { kind: 'exact', date: '2030-05-01' },
      confidence: 'confirmed',
    }],
  }],
}

test.beforeEach(async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => {
    const url = route.request().url()
    if (url.includes('/commits/')) return route.fulfill({ json: { sha } })
    if (url.includes('/issues?')) return route.fulfill({ json: [] })
    return route.fulfill({ json: { default_branch: 'main', private: false } })
  })
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({ json: feed }))
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ json: feed }))
})

test('channel and event links open as standalone detail pages', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/channels/view?source=github%3Atest%2Ffeed')
  await expect(page.getByRole('heading', { name: '发售频道' })).toBeVisible()
  await expect(page.getByText('值得期待的新作')).toBeVisible()
  await page.getByRole('button', { name: '复制链接' }).click()
  await expect(page.getByRole('button', { name: '链接已复制' })).toBeVisible()
  await page.getByRole('link', { name: /新游戏/ }).click()
  await expect(page).toHaveURL(/\/events\/new-game\?source=github%3Atest%2Ffeed/)
  await expect(page.getByRole('heading', { name: '新游戏' })).toBeVisible()
  await expect(page.getByText('一场新的冒险')).toBeVisible()
})

test('invalid resource links fail without changing profile state', async ({ page }) => {
  await page.goto('/channels/view?source=github%3Atest%2Ffeed%23..%252Fsecret')
  await expect(page.getByRole('alert')).toContainText('无法打开此资源')
  await expect(page.getByRole('button', { name: '订阅频道' })).toHaveCount(0)
})

test('profile detail resolves its visible activity and can be followed', async ({ page }) => {
  const profile = {
    oefVersion: '0.1',
    kind: 'user-data',
    id: 'friend',
    displayName: { 'zh-CN': '小明的盼头' },
    bio: { 'zh-CN': '喜欢新的冒险' },
    favorites: ['new-game'],
    subscriptions: [{ locator: 'github:test/feed', kind: 'event-feed' }],
  }
  await page.route('https://cdn.jsdelivr.net/gh/test/user@**', (route) => route.fulfill({ json: profile }))
  await page.route('https://raw.githubusercontent.com/test/user/**', (route) => route.fulfill({ json: profile }))
  await page.goto('/people/view?source=github%3Atest%2Fuser')
  await expect(page.getByRole('heading', { name: '小明的盼头' })).toBeVisible()
  await expect(page.getByText('喜欢新的冒险')).toBeVisible()
  await expect(page.getByRole('link', { name: /新游戏/ })).toBeVisible()
  await page.getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.getByRole('button', { name: '已关注', exact: true })).toBeVisible()
})

test('private links require repository access and are fetched again after reload', async ({ page }) => {
  let privateReads = 0
  await page.unroute('https://api.github.com/**')
  await page.route('https://api.github.com/**', (route) => {
    const request = route.request()
    const url = request.url()
    const authorized = Boolean(request.headers().authorization)
    if (url.endsWith('/user')) return route.fulfill({ json: { id: 7, login: 'reader' } })
    if (url.includes('/user/repos')) return route.fulfill({ json: [] })
    if (url.includes('/issues?')) return route.fulfill({ json: [] })
    if (url.includes('/repos/test/private-feed')) {
      if (!authorized) return route.fulfill({ status: 404, json: { message: 'Not Found' } })
      if (url.includes('/contents/')) {
        privateReads++
        return route.fulfill({ json: {
          type: 'file', path: 'ahead.yaml', sha, encoding: 'base64',
          content: Buffer.from(JSON.stringify(feed)).toString('base64'),
        } })
      }
      if (url.includes('/commits/')) return route.fulfill({ json: { sha, commit: { committer: { date: null } } } })
      return route.fulfill({ json: {
        id: 99, name: 'private-feed', default_branch: 'main', private: true,
        permissions: { push: false },
      } })
    }
    return route.fulfill({ status: 404, json: { message: 'Not Found' } })
  })
  await page.goto('/channels/view?source=github%3Atest%2Fprivate-feed')
  await expect(page.getByText('登录 GitHub 后查看此资源')).toBeVisible()
  await page.getByRole('link', { name: '登录 GitHub' }).click()
  await page.getByText('使用访问令牌登录', { exact: true }).click()
  await page.getByLabel('GitHub 访问令牌').fill('test-token')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('heading', { name: '发售频道' })).toBeVisible()
  await expect(page.getByText('私有', { exact: true })).toBeVisible()
  expect(privateReads).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { name: '发售频道' })).toBeVisible()
  expect(privateReads).toBe(2)
})
