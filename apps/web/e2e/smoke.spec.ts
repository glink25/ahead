import { test, expect, type Page } from '@playwright/test'

const sha = 'a'.repeat(40)
async function registry(page: Page) {
  const date = new Date()
  const year = date.getFullYear(), month = date.getMonth() + 1
  const event = (id: string, day: number) => ({
    id, title: { 'zh-CN': id }, tags: ['test'], schedule: [
      { id: 'estimate', recordedAt: '2025-01-01T00:00:00Z', value: { kind: 'year', year }, confidence: 'likely' },
      { id: 'confirmed', recordedAt: '2025-02-01T00:00:00Z', value: { kind: 'exact', date: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0') }, confidence: 'confirmed' },
    ],
  })
  const feeds = {
    'gaming.yaml': { oefVersion: '0.1', kind: 'event-feed', id: 'gaming', name: { 'zh-CN': '游戏源' }, events: [event('first-game', 15), event('second-game', 20)] },
    'tech.yaml': { oefVersion: '0.1', kind: 'event-feed', id: 'tech', name: { 'zh-CN': '科技源' }, events: [event('tech-event', 25)] },
  }
  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/issues?')) return route.fulfill({ json: Object.keys(feeds).map((path, i) => ({
      number: i + 1, title: path, html_url: 'https://github.com/a/b/issues/' + (i + 1), labels: [{ name: 'approved' }],
      body: '<!-- ahead:source:' + JSON.stringify({ schema: 1, locator: 'github:test/showcase', manifestPath: 'feeds/' + path, resourceType: 'event-feed', validatedSha: sha }) + ' -->',
    })) })
    if (url.includes('/commits/')) return route.fulfill({ json: { sha } })
    return route.fulfill({ json: { private: false, default_branch: 'trunk' } })
  })
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const path = route.request().url().split('/').at(-1) as keyof typeof feeds
    return route.fulfill({ body: JSON.stringify(feeds[path]), contentType: 'text/yaml' })
  })
}

test('discover → scroll → favorite → swipe mine → calendar → detail → reload', async ({ page, isMobile }) => {
  await registry(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/discover')
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: '正在更新开放事件源' })).toHaveCount(0)
  const first = page.locator('.poster-slot').first()
  await expect(first.getByRole('heading')).toBeVisible()
  await page.locator('.discover-scroll').evaluate((el) => { el.scrollTop = el.clientHeight })
  await expect(page.locator('[data-index="1"]')).toBeInViewport()
  const second = page.locator('[data-index="1"]')
  await second.getByRole('button', { name: '喜爱', exact: true }).click()
  const title = await second.getByRole('heading').innerText()
  // Exercise Pointer Events axis locking rather than replacing the gesture with navigation.
  // Use a real pointer so browser capture and axis locking are exercised.
  if (isMobile) {
    const touch = await page.context().newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 220 }] })
    for (let x = 110; x <= 290; x += 20) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: 224 }] })
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await touch.detach()
  } else {
    await page.mouse.move(90, 220)
    await page.mouse.down()
    await page.mouse.move(280, 224, { steps: 8 })
    await page.mouse.up()
  }
  await expect(page).toHaveURL(/\/mine/)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await page.getByRole('button', { name: '切换日历' }).click()
  await expect(page.locator('.month-grid')).toBeVisible()
  await page.locator('.month-grid').getByRole('link', { name: title, exact: true }).click()
  await expect(page.getByRole('heading', { name: '日期如何逐渐确定' })).toBeVisible()
  await expect(page.locator('.schedule-timeline li')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('button', { name: '取消喜爱' })).toBeVisible()
  expect(errors).toEqual([])
})

test('same repository feeds subscribe independently and cached events survive network failure', async ({ page }) => {
  await registry(page)
  await page.goto('/discover')
  await expect(page.locator('.loading-strip')).toHaveCount(0)
  await page.locator('.poster-slot').first().getByRole('button', { name: '+ 订阅源' }).click()
  await page.goto('/following')
  await expect(page.locator('.following-card')).toHaveCount(1)
  await expect(page.locator('.following-card')).toContainText('feeds/gaming.yaml')
  await page.goto('/mine')
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await page.route('https://api.github.com/**', (route) => route.abort())
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort())
  await page.reload()
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await expect(page.locator('.error-strip')).toBeVisible()
})
