import { test, expect, type Page } from '@playwright/test'
interface Repo {
  name: string
  private: boolean
  description: string
  files: Record<string, string>
  sha: string
  id: number
}
async function github(page: Page, repos = new Map<string, Repo>()) {
  let sequence = 100
  const blobs = new Map<string, string>(),
    trees = new Map<string, Record<string, string>>(),
    commits = new Map<string, Record<string, string>>()
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = decodeURIComponent(url.pathname)
    const body = request.postDataJSON() as Record<string, any> | null
    const reply = (json: unknown, status = 200) =>
      route.fulfill({
        status,
        json,
        headers: { 'x-oauth-scopes': 'repo,read:user' },
      })
    if (path === '/user')
      return reply({ login: 'tester', id: 7, name: 'Tester' })
    if (path === '/user/repos' && request.method() === 'GET')
      return reply(
        Number(url.searchParams.get('page') ?? 1) > 1
          ? []
          : [...repos.values()].map((r) => ({
              name: r.name,
              id: r.id,
              owner: { login: 'tester' },
              private: r.private,
              permissions: { push: true },
            })),
      )
    if (path === '/user/repos') {
      if (repos.has(body!.name)) return reply({ message: 'exists' }, 422)
      const repo: Repo = {
        name: body!.name,
        private: body!.private,
        description: body!.description,
        files: {},
        sha: String(++sequence),
        id: sequence,
      }
      repos.set(repo.name, repo)
      return reply(
        {
          ...repo,
          owner: { login: 'tester' },
          default_branch: 'main',
          html_url: 'https://github.com/tester/' + repo.name,
        },
        201,
      )
    }
    if (path.endsWith('/issues')) return reply([])
    const match = /^\/repos\/tester\/([^/]+)(.*)$/.exec(path)
    if (!match) return reply({ message: 'Not Found' }, 404)
    const repo = repos.get(match[1]!),
      suffix = match[2]!
    if (!repo) return reply({ message: 'Not Found' }, 404)
    if (!suffix)
      return reply({
        id: repo.id,
        name: repo.name,
        private: repo.private,
        description: repo.description,
        default_branch: 'main',
        permissions: { push: true },
      })
    if (suffix.startsWith('/commits/'))
      return reply({
        sha: repo.sha,
        commit: { committer: { date: new Date().toISOString() } },
      })
    if (suffix.startsWith('/contents/')) {
      const key = suffix.slice('/contents/'.length),
        content = repo.files[key]
      if (content === undefined) return reply({ message: 'Not Found' }, 404)
      return reply({
        type: 'file',
        path: key,
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
        sha: repo.sha,
      })
    }
    if (suffix.startsWith('/git/ref/'))
      return reply({ object: { sha: repo.sha } })
    if (suffix.startsWith('/git/commits/') && request.method() === 'GET')
      return reply({ tree: { sha: repo.sha } })
    if (suffix === '/git/blobs') {
      const sha = String(++sequence)
      blobs.set(sha, body!.content)
      return reply({ sha }, 201)
    }
    if (suffix === '/git/trees') {
      const sha = String(++sequence),
        files = { ...repo.files }
      for (const entry of body!.tree) files[entry.path] = blobs.get(entry.sha)!
      trees.set(sha, files)
      return reply({ sha }, 201)
    }
    if (suffix === '/git/commits') {
      const sha = String(++sequence)
      commits.set(sha, trees.get(body!.tree)!)
      return reply({ sha }, 201)
    }
    if (suffix.startsWith('/git/refs/') && request.method() === 'PATCH') {
      repo.sha = body!.sha
      repo.files = commits.get(repo.sha)!
      return reply({ object: { sha: repo.sha } })
    }
    return reply({ message: 'unsupported ' + path }, 404)
  })
  return repos
}
async function save(page: Page, title: string) {
  await page.getByRole('link', { name: '新建事件', exact: true }).last().click()
  await page.getByPlaceholder('有什么值得期待？').fill(title)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible()
}
test('guest event saves, edits, deletes and restores without a login', async ({
  page,
}) => {
  await github(page)
  await page.goto('/mine')
  await save(page, '本机日程')
  await page.reload()
  await expect(
    page.getByRole('heading', { name: '本机日程', exact: true }),
  ).toBeVisible()
  await page.getByRole('link', { name: '编辑', exact: true }).click()
  await page.getByPlaceholder('有什么值得期待？').fill('修改后的日程')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.timeline-row')).toHaveCount(0)
  await page.goto('/history')
  await page.locator('.settings-disclosure summary').first().click()
  await page.getByRole('button', { name: '恢复', exact: true }).first().click()
  await expect(
    page.getByRole('status').filter({ hasText: '已恢复到此资料' }),
  ).toBeVisible()
  await page.goto('/mine')
  await expect(page.locator('.timeline-row')).toContainText('修改后的日程')
})
test('login selects profiles, auto-syncs standard manifests and keeps public/private data separate', async ({
  page,
}) => {
  const repos = await github(page)
  await page.goto('/mine')
  await save(page, '访客事件')
  await page.goto('/login')
  await page.locator('summary').filter({ hasText: '使用访问令牌登录' }).click()
  await page.getByLabel('GitHub 访问令牌').fill('test-token')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/profiles/)
  await page.getByPlaceholder('例如：我的盼头、工作、游戏').fill('私人生活')
  await page.getByRole('button', { name: '创建并使用' }).click()
  await expect(page.locator('.timeline-row')).toContainText('访客事件')
  await expect
    .poll(
      () =>
        [...repos.values()].filter(
          (r) =>
            r.name.startsWith('ahead-feed-personal-') &&
            r.files['ahead.yaml']?.includes('访客事件'),
        ).length,
      { timeout: 15000 },
    )
    .toBe(1)
  const privateFeed = [...repos.values()].find((r) =>
    r.name.startsWith('ahead-feed-personal-'),
  )!
  expect(privateFeed.private).toBe(true)
  await expect
    .poll(() =>
      [...repos.values()].some(
        (r) =>
          r.name.startsWith('ahead-user-') &&
          r.files['ahead.yaml']?.includes(privateFeed.name),
      ),
    )
    .toBe(true)
  await page.goto('/profiles')
  await page.locator('summary').filter({ hasText: '新建个人资料' }).click()
  await page.getByPlaceholder('例如：我的盼头、工作、游戏').fill('公开游戏')
  await page.getByRole('combobox').selectOption('public')
  await page.getByRole('button', { name: '创建并使用' }).click()
  await expect(page.locator('.timeline-row')).toHaveCount(0)
  await save(page, '公开事件')
  await expect
    .poll(
      () =>
        [...repos.values()].some(
          (r) =>
            !r.private &&
            r.name.startsWith('ahead-feed-personal-') &&
            r.files['ahead.yaml']?.includes('公开事件'),
        ),
      { timeout: 15000 },
    )
    .toBe(true)
  expect(
    [...repos.values()]
      .filter((r) => !r.private)
      .every((r) => !JSON.stringify(r.files).includes('访客事件')),
  ).toBe(true)
  await page.goto('/profiles')
  await page.getByRole('button', { name: /私人生活/ }).click()
  await expect(page.locator('.timeline-row')).toContainText('访客事件')
  await expect(page.locator('.timeline-row')).not.toContainText('公开事件')
  const registryCredentials: boolean[] = []
  page.on('request', request => {
    if (request.url().includes('api.github.com/') && request.url().includes('/issues?'))
      registryCredentials.push(Boolean(request.headers().authorization))
  })
  let release!: () => void
  const restoring = new Promise<void>(resolve => { release = resolve })
  await page.route('https://api.github.com/user', async route => { await restoring; await route.fallback() })
  await page.reload()
  await expect(page.getByRole('status')).toHaveText('正在恢复账户…')
  await expect(page.getByRole('link', { name: '新建事件', exact: true })).toHaveCount(0)
  release()
  await expect.poll(() => registryCredentials.length).toBeGreaterThan(0)
  expect(registryCredentials.every(Boolean)).toBe(true)
})

test('two tabs preserve concurrent local event writes', async ({
  page,
  context,
}) => {
  await github(page)
  await page.goto('/mine')
  const second = await context.newPage()
  await github(second)
  await second.goto('/mine')
  await Promise.all([save(page, '第一窗口事件'), save(second, '第二窗口事件')])
  await page.goto('/mine')
  await expect(page.locator('.timeline-row')).toHaveCount(2)
  await expect(
    page.locator('.timeline-row').filter({ hasText: '第一窗口事件' }),
  ).toBeVisible()
  await expect(
    page.locator('.timeline-row').filter({ hasText: '第二窗口事件' }),
  ).toBeVisible()
  await second.close()
})
