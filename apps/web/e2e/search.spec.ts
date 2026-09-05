import { expect, test } from '@playwright/test'

test('clicking a feed tag opens search, fills it and reports sign-in requirement', async ({ page }) => {
  const sha = 'a'.repeat(40)
  await page.route('https://api.github.com/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/issues'))
      return route.fulfill({
        json: [{
          number: 1,
          title: 'games',
          html_url: 'https://github.com/test/registry/issues/1',
          labels: [{ name: 'approved' }],
          body: '<!-- ahead:source:{"schema":1,"locator":"github:test/games","manifestPath":"ahead.yaml","resourceType":"event-feed"} -->',
        }],
      })
    return route.fulfill({
      json: url.pathname.includes('/commits/')
        ? { sha }
        : { private: false, default_branch: 'main' },
    })
  })
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    json: {
      oefVersion: '0.1',
      kind: 'event-feed',
      id: 'games',
      name: { en: 'Games' },
      tags: [{ id: 'games', label: { en: 'Games' } }],
      events: [{
        id: 'launch',
        title: { en: 'Launch' },
        tags: ['games'],
        schedule: [{
          id: 's',
          recordedAt: '2026-01-01T00:00:00Z',
          confidence: 'confirmed',
          value: { kind: 'exact', date: '2030-01-01' },
        }],
      }],
    },
  }))
  await page.goto('/discover')
  await page.getByRole('link', { name: '# Games' }).click()
  await expect(page).toHaveURL(/\/search\?tag=games$/)
  await expect(page.getByRole('textbox', { name: '搜索事件' })).toHaveValue('#games')
  await expect(page.getByRole('heading', { name: '登录 GitHub 后即可搜索事件' })).toBeVisible()
})
