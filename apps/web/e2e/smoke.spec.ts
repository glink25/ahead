import { test, expect, type Page } from '@playwright/test'

const sha = 'a'.repeat(40)
async function registry(page: Page, rich = false) {
  const date = new Date()
  const year = date.getFullYear(),
    month = date.getMonth() + 1
  const event = (id: string, day: number) => ({
    id,
    title: { 'zh-CN': id },
    tags: ['test'],
    ...(rich
      ? {
          summary: { 'zh-CN': '这是一段保留在发现页的事件描述。'.repeat(24) },
          evidence: [
            {
              kind: 'url',
              value: 'https://example.com/event',
              label: { 'zh-CN': '活动网站' },
            },
          ],
        }
      : {}),
    schedule: [
      {
        id: 'estimate',
        recordedAt: '2025-01-01T00:00:00Z',
        value: { kind: 'year', year },
        confidence: 'likely',
      },
      {
        id: 'confirmed',
        recordedAt: '2025-02-01T00:00:00Z',
        value: {
          kind: 'exact',
          date:
            year +
            '-' +
            String(month).padStart(2, '0') +
            '-' +
            String(day).padStart(2, '0'),
        },
        confidence: 'confirmed',
      },
    ],
  })
  const feeds = {
    'gaming.yaml': {
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'gaming',
      name: { 'zh-CN': '游戏源' },
      events: [event('first-game', 15), event('second-game', 20)],
    },
    'tech.yaml': {
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'tech',
      name: { 'zh-CN': '科技源' },
      events: [event('tech-event', 25)],
    },
  }
  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/issues?'))
      return route.fulfill({
        json: Object.keys(feeds).map((path, i) => ({
          number: i + 1,
          title: path,
          html_url: 'https://github.com/a/b/issues/' + (i + 1),
          labels: [{ name: 'approved' }],
          body:
            '<!-- ahead:source:' +
            JSON.stringify({
              schema: 1,
              locator: 'github:test/showcase',
              manifestPath: 'feeds/' + path,
              resourceType: 'event-feed',
              validatedSha: sha,
            }) +
            ' -->',
        })),
      })
    if (url.includes('/commits/')) return route.fulfill({ json: { sha } })
    return route.fulfill({ json: { private: false, default_branch: 'trunk' } })
  })
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const path = route.request().url().split('/').at(-1) as keyof typeof feeds
    return route.fulfill({
      body: JSON.stringify(feeds[path]),
      contentType: 'text/yaml',
    })
  })
}

test('discover → scroll → favorite → swipe mine → calendar → detail → reload', async ({
  page,
  isMobile,
}) => {
  await registry(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/discover')
  await expect(
    page
      .getByRole('status', { name: '' })
      .filter({ hasText: '正在更新开放事件源' }),
  ).toHaveCount(0)
  const first = page.locator('.poster-slot').first()
  await expect(first.getByRole('heading')).toBeVisible()
  await page.locator('.discover-scroll').evaluate((el) => {
    el.scrollTop = el.clientHeight
  })
  await expect(page.locator('[data-index="1"]')).toBeInViewport()
  const second = page.locator('[data-index="1"]')
  await second.getByRole('button', { name: '喜爱', exact: true }).click()
  const title = await second.getByRole('heading').innerText()
  const heading = await second.getByRole('heading').boundingBox()
  if (!heading) throw new Error('Discover heading has no bounding box')
  const swipeStart = {
    x: heading.x + Math.min(20, heading.width / 2),
    y: heading.y + heading.height / 2,
  }
  // Exercise Pointer Events axis locking rather than replacing the gesture with navigation.
  // Start on the event link to verify a horizontal gesture wins over its click.
  if (isMobile) {
    const touch = await page.context().newCDPSession(page)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [swipeStart],
    })
    for (let dx = 20; dx <= 200; dx += 20)
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: swipeStart.x + dx, y: swipeStart.y + 4 }],
      })
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await touch.detach()
  } else {
    await page.mouse.move(swipeStart.x, swipeStart.y)
    await page.mouse.down()
    await page.mouse.move(swipeStart.x + 200, swipeStart.y + 4, { steps: 8 })
    await page.mouse.up()
  }
  await expect(page).toHaveURL(/\/mine/)
  const timelineTitle = page.getByRole('heading', { name: title, exact: true })
  await expect(timelineTitle).toBeVisible()
  const timelineSection = timelineTitle.locator('xpath=ancestor::section')
  await expect(timelineSection.locator('.bucket-heading')).toContainText(
    /还有|已过去|就在今天|就在明天|正在进行/,
  )
  await expect(timelineSection.locator('.timeline-copy small')).toContainText(
    String(new Date().getFullYear()),
  )
  const favorite = timelineSection.getByRole('button', {
    name: '取消喜爱',
    exact: true,
  })
  const favoriteBox = await favorite.boundingBox()
  if (!favoriteBox) throw new Error('Favorite button has no bounding box')
  await page.mouse.move(
    favoriteBox.x + favoriteBox.width / 2,
    favoriteBox.y + favoriteBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    favoriteBox.x + favoriteBox.width / 2 - 200,
    favoriteBox.y + favoriteBox.height / 2 + 3,
    { steps: 8 },
  )
  await page.mouse.up()
  await expect(page).toHaveURL(/\/discover/)
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await expect(timelineSection.getByRole('button', { name: '取消喜爱' })).toBeVisible()
  await page.getByRole('button', { name: '切换日历' }).click()
  await expect(page.locator('.month-scroll')).toBeVisible()
  await page
    .locator('.month-grid')
    .getByRole('link', { name: title, exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '日期记录' })).toBeVisible()
  await expect(page.locator('.schedule-timeline li')).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('button', { name: '取消喜爱' })).toBeVisible()
  expect(errors).toEqual([])
})

test('same repository feeds subscribe independently and cached events survive network failure', async ({
  page,
}) => {
  await registry(page)
  await page.goto('/discover')
  await expect(page.locator('.loading-strip')).toHaveCount(0)
  await page
    .locator('.poster-slot')
    .first()
    .getByRole('button', { name: '订阅频道' })
    .click()
  await expect(
    page
      .locator('.poster-slot')
      .first()
      .getByRole('button', { name: '已订阅', exact: true }),
  ).toBeVisible()
  await page.goto('/following')
  await expect(page.locator('.following-card')).toHaveCount(1)
  await page.getByText('频道详情', { exact: true }).click()
  await expect(page.locator('.following-card')).toContainText(
    'feeds/gaming.yaml',
  )
  await page.goto('/mine')
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await page.route('https://api.github.com/**', (route) => route.abort())
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort())
  await page.reload()
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  // Fresh cache avoids network reads; an explicit refresh still exposes failures.
  await expect(page.locator('.error-strip')).toHaveCount(0)
  await page.goto('/settings')
  await page.getByRole('button', { name: /更新频道内容/ }).click()
  await expect(page.locator('.loading-progress')).toHaveCount(0)
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await expect(page.locator('.error-strip')).toBeVisible()
})

test('empty calendar supports year and week; editor previews without saving', async ({
  page,
}) => {
  await registry(page)
  await page.goto('/mine?view=calendar&date=2028-02-29')
  await expect(page.locator('.month-scroll')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '2028-02-29', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '年', exact: true }).click()
  await expect(page.locator('.mini-month')).toHaveCount(12)
  await page.getByRole('button', { name: '周', exact: true }).click()
  await expect(
    page.locator('.week-strip button[aria-pressed=true]'),
  ).toHaveText(/周?二29/)
  await page.getByRole('link', { name: '新建事件', exact: true }).click()
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByText('请输入事件名称')).toBeVisible()
  await page.getByPlaceholder('有什么值得期待？').fill('周末散步')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('article', { name: '事件预览' })).toContainText(
    '周末散步',
  )
  await page.getByRole('button', { name: '高级编辑' }).click()
  const yaml = page.getByRole('textbox', { name: '事件 YAML' })
  await yaml.fill(
    (await yaml.inputValue()) +
      'recurrence:\n  freq: yearly\nextensions:\n  keep: yes\n',
  )
  await page.getByRole('button', { name: '返回表单' }).click()
  await page.getByPlaceholder('有什么值得期待？').fill('周末出游')
  await page.getByRole('button', { name: '高级编辑' }).click()
  await expect(yaml).toHaveValue(/freq: yearly/)
  await expect(yaml).toHaveValue(/keep: yes/)
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(
    page.locator('.week-strip button[aria-pressed=true]'),
  ).toHaveText(/周?二29/)
})

test('tab navigation refreshes discovery while detail back preserves position and settings hide diagnostics', async ({
  page,
}) => {
  await registry(page)
  await page.goto('/discover')
  await expect(
    page.locator('.poster-slot').first().getByRole('heading'),
  ).toBeVisible()
  await page.locator('.discover-scroll').evaluate((el) => {
    el.scrollTop = el.clientHeight
  })
  await expect(page.locator('[data-index="1"]')).toBeInViewport()
  await page.getByRole('link', { name: '我的', exact: true }).click()
  await page.getByRole('link', { name: '发现', exact: true }).click()
  await expect(page.locator('[data-index="0"]')).toBeInViewport()
  await page.locator('[data-index="0"]').getByRole('heading').click()
  await page.getByRole('button', { name: '返回上一页' }).click()
  await expect(page.locator('[data-index="0"]')).toBeInViewport()
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '设置', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('暂无异常')).not.toBeVisible()
  await expect(page.getByText('权重限制在 -1 到 1。')).toHaveCount(0)
})

test('short-screen discovery retains expandable descriptions and direct links', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await registry(page, true)
  await page.goto('/discover')
  const poster = page.locator('[data-index="0"]')
  await expect(poster.getByRole('link', { name: '活动网站' })).toBeInViewport()
  await poster.getByRole('button', { name: '展开', exact: true }).click()
  await expect(poster.locator('.poster-summary.expanded')).toBeVisible()
  await expect(poster.getByRole('link', { name: '活动网站' })).toHaveAttribute(
    'href',
    'https://example.com/event',
  )
  await expect(
    poster.getByRole('button', { name: '喜爱', exact: true }),
  ).toBeInViewport()
  await poster.getByRole('button', { name: '收起', exact: true }).click()
  await expect(poster).toBeInViewport()
})

test('calendar scrolling stays bounded and Today returns to the current month', async ({
  page,
}) => {
  await registry(page)
  await page.goto('/mine?view=calendar')
  const scroll = page.locator('.month-scroll')
  await expect(scroll).toBeVisible()
  const initial = await scroll.evaluate((el) => el.scrollTop)
  await scroll.evaluate((el) => {
    el.scrollTop += 620
  })
  await expect
    .poll(async () => {
      const snapped = await scroll.evaluate((el) => el.scrollTop)
      const delta = snapped - initial
      return delta >= 400 && delta <= 525
    })
    .toBe(true)
  await expect(page.locator('.calendar-month')).toHaveCount(5)
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(initial)
})
