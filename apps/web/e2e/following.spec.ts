import { test, expect } from '@playwright/test'

test('following changes recommendations without inheriting events; unfollow removes the signal', async ({ page }) => {
  const sha = 'b'.repeat(40)
  const event = (id: string) => ({ id, title: { 'zh-CN': id }, schedule: [{ id: 's', recordedAt: '2026-01-01T00:00:00Z', value: { kind: 'exact', date: '2030-01-01' }, confidence: 'confirmed' }] })
  const feed = { oefVersion: '0.1', kind: 'event-feed', id: 'feed', name: { 'zh-CN': '测试源' }, events: [event('a-neutral'), event('b-friend-favorite')] }
  const user = { oefVersion: '0.1', kind: 'user-data', id: 'friend', displayName: { 'zh-CN': '测试朋友' }, favorites: ['b-friend-favorite'], subscriptions: [{ locator: 'github:test/feed', kind: 'event-feed' }] }
  await page.route('https://api.github.com/**', async route => {
    const url = route.request().url()
    if (url.includes('/issues?')) return route.fulfill({ json: ['event-feed', 'user-data'].map((kind, i) => ({
      number: i + 1, title: i ? '测试朋友' : '测试源', html_url: 'https://github.com/test/registry/issues/' + (i+1), labels: [{ name: 'approved' }],
      body: '<!-- ahead:source:' + JSON.stringify({ schema: 1, resourceType: kind, locator: 'github:test/' + (i ? 'user' : 'feed'), name: { 'zh-CN': i ? '测试朋友' : '测试源' } }) + ' -->',
    })) })
    return route.fulfill({ json: url.includes('/commits/') ? { sha } : { default_branch: 'main', private: false } })
  })
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ json: route.request().url().includes('/user@') ? user : feed }))
  await page.goto('/discover')
  await expect(page.locator('[data-index="0"] h1')).toHaveText('a-neutral')
  await page.goto('/following')
  await page.getByRole('button', { name: '关注', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消关注', exact: true })).toBeVisible()
  await page.goto('/discover')
  await expect(page.locator('[data-index="0"] h1')).toHaveText('b-friend-favorite')
  await page.goto('/mine')
  await expect(page.locator('.timeline-row')).toHaveCount(0)
  await page.goto('/following')
  await page.getByRole('button', { name: '取消关注', exact: true }).click()
  await expect(page.getByRole('button', { name: '关注', exact: true })).toBeVisible()
  await page.goto('/discover')
  await expect(page.locator('[data-index="0"] h1')).toHaveText('a-neutral')
})
