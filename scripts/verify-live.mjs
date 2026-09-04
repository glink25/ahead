/** Opt-in real GitHub integration. Creates repositories on the two named accounts.
 * Credentials stay in memory; no traces, auth screenshots, or storageState files.
 * Run: AHEAD_LIVE=1 node scripts/verify-live.mjs [baseURL]
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
if (process.env.AHEAD_LIVE !== '1') throw new Error('Set AHEAD_LIVE=1 to create real test resources')
const baseURL = process.argv[2] || 'http://127.0.0.1:4455'
const previous = process.env.AHEAD_RESUME ? JSON.parse(readFileSync(process.env.AHEAD_RESUME, 'utf8')) : undefined
const run = previous?.run || new Date().toISOString().replace(/[:.]/g, '-')
const trial = Date.now()
const out = `artifacts/verification/${run}${previous ? '-resume-' + Date.now() : ''}`
mkdirSync(out, { recursive: true })
const accounts = ['glink24', 'glink25']
const tokens = Object.fromEntries(accounts.map(a => [a, execFileSync('gh', ['auth', 'token', '--user', a], { encoding: 'utf8' }).trim()]))
const report = { baseURL, run, authentication: 'GitHub CLI credentials through token-login UI; OAuth requires separate interactive verification', checks: [], resources: previous?.resources || [] }
function record(name, details = {}) { report.checks.push({ name, ...details }); console.log(name); flush() }
function flush() { writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)) }
async function api(account, path, method = 'GET', body) {
  const r = await fetch('https://api.github.com' + path, { method, cache: 'no-store', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${tokens[account]}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status}`)
  return r.status === 204 ? undefined : r.json()
}
async function state(p) {
  return p.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('ahead-workspaces')
    req.onsuccess = () => { const db = req.result; const read = db.transaction('state').objectStore('state').get('root'); read.onsuccess = () => { db.close(); resolve(read.result) }; read.onerror = () => reject(read.error) }
    req.onerror = () => reject(req.error)
  }))
}
async function active(p) { const db = await state(p); return db.spaces[db.active] }
async function synced(p) {
  await expect.poll(async () => { const s = await active(p); if (s.status === 'attention' || s.status === 'auth') throw new Error(s.error); return s.status + ':' + s.pending.length }, { timeout: 120000, intervals: [1000, 2000] }).toBe('synced:0')
  return active(p)
}
async function sync(p) { await p.goto(baseURL + '/settings'); await p.getByRole('button', { name: '立即同步' }).click(); await synced(p) }
async function login(p, account) {
  await p.goto(baseURL + '/login')
  await p.locator('summary').filter({ hasText: '使用访问令牌登录' }).click()
  await p.getByLabel('GitHub 访问令牌').fill(tokens[account])
  await p.getByRole('button', { name: '登录', exact: true }).click()
  await expect(p).toHaveURL(/profiles/, { timeout: 30000 })
}
async function create(p, name, visibility = 'public') {
  await p.goto(baseURL + '/profiles')
  await expect(p.locator('.profiles-view > .muted')).toContainText('@')
  const section = p.locator('details').filter({ has: p.getByPlaceholder('例如：我的盼头、工作、游戏') })
  if (await section.getAttribute('open') === null) await section.locator('summary').click()
  await p.getByPlaceholder('例如：我的盼头、工作、游戏').fill(name)
  await p.getByRole('combobox').selectOption(visibility)
  await p.getByRole('button', { name: '创建并使用' }).click()
  await expect(p).toHaveURL(/mine/)
}
async function save(p, title) {
  await p.goto(baseURL + '/studio')
  await p.getByPlaceholder('有什么值得期待？').fill(title)
  await p.getByRole('button', { name: '保存', exact: true }).click()
  await expect(p.getByRole('heading', { name: title, exact: true })).toBeVisible()
}
async function connect(p, target) {
  await p.goto(baseURL + '/profiles')
  await expect(p.locator('.profiles-view > .muted')).toContainText('@')
  const known = p.locator('.profile-list article').filter({ hasText: target.owner + '/' + target.repo }).getByRole('button').first()
  if (await known.count()) { await known.click(); await expect(p).toHaveURL(/mine/, { timeout: 30000 }); return }
  await p.locator('summary').filter({ hasText: '通过仓库地址添加' }).click()
  await p.getByPlaceholder('github:owner/ahead-user-main').fill(`github:${target.owner}/${target.repo}`)
  await p.getByRole('button', { name: '添加并使用' }).click()
  await expect(p).toHaveURL(/mine/, { timeout: 30000 })
}
async function document(account, target) {
  const data = await api(account, `/repos/${target.owner}/${target.repo}/contents/${target.path}`)
  const { parse } = createRequire(new URL('../packages/protocol/package.json', import.meta.url))('yaml')
  return parse(Buffer.from(data.content, 'base64').toString())
}
const browser = await chromium.launch()
const pages = []
try {
  for (const account of accounts) {
    console.log(`${account}: authenticating and creating test profile`)
    assert.equal((await api(account, '/user')).login, account)
    const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(30000); pages.push(page)
    page.on('response', async response => { if (response.status() !== 403) return; try { report.networkErrors ??= []; report.networkErrors.push({ path: new URL(response.url()).pathname, authenticated: Boolean(response.request().headers().authorization), message: (await response.json()).message, remaining: response.headers()['x-ratelimit-remaining'] }); flush() } catch {} })
    await login(page, account)
    const existing = report.resources.find(r => r.account === account)
    if (existing) await connect(page, existing.profile)
    else {
      await create(page, `链路验证 ${account} ${run}`)
      await save(page, `公开事件 ${account} ${run}`)
    }
    const s = await synced(page)
    if (!existing) report.resources.push({ account, profile: s.remote, feed: s.feed }); flush()
    const feed = await document(account, s.feed)
    assert(feed.events.some(e => Object.values(e.title).some(t => t.includes(account))))
    record(`${account}: UI create → real GitHub manifests`, { profile: s.remote, feed: s.feed })
    await page.goto(baseURL + '/mine'); await page.reload(); await synced(page)
    await expect(page.getByRole('heading', { name: `公开事件 ${account} ${run}`, exact: true })).toBeVisible()
    record(`${account}: reload restores identity/profile/event`)
  }
  const [a,b] = pages, source = report.resources[0]
  if (process.env.AHEAD_PHASE !== 'market') {
  for (const target of [source.profile, source.feed]) {
    const invite = await api('glink24', `/repos/glink24/${target.repo}/collaborators/glink25`, 'PUT', { permission: 'push' })
    if (invite?.id) await api('glink25', `/user/repository_invitations/${invite.id}`, 'PATCH')
  }
  await connect(b, source.profile); await synced(b)
  await b.goto(baseURL + '/mine')
  await expect(b.locator('.timeline-row').filter({ hasText: `公开事件 glink24 ${run}` })).toHaveCount(1)
  record('collaborator connects profile and loads associated personal feed')
  await Promise.all([save(a, `并发 A ${trial}`), save(b, `并发 B ${trial}`)])
  await Promise.all([synced(a), synced(b)])
  await sync(a); await sync(b)
  for (const p of [a,b]) {
    await p.goto(baseURL + '/mine')
    await expect(p.locator('.timeline-row').filter({ hasText: `并发 A ${trial}` })).toHaveCount(1)
    await expect(p.locator('.timeline-row').filter({ hasText: `并发 B ${trial}` })).toHaveCount(1)
  }
  record('two accounts concurrently create distinct events and converge')
  await a.goto(baseURL + '/studio')
  await expect(a.getByPlaceholder('有什么值得期待？')).toBeVisible()
  await a.context().setOffline(true)
  await a.getByPlaceholder('有什么值得期待？').fill(`离线 ${trial}`)
  await a.getByRole('button', { name: '保存', exact: true }).click()
  await expect(a.getByRole('heading', { name: `离线 ${trial}`, exact: true })).toBeVisible()
  await a.context().setOffline(false); await synced(a); await sync(b)
  await b.goto(baseURL + '/mine'); await expect(b.locator('.timeline-row').filter({ hasText: `离线 ${trial}` })).toHaveCount(1)
  record('offline edit reconnects and arrives at collaborator')
  // Revoke only the test collaborator's Feed permission, then recover its outbox.
  await api('glink24', `/repos/glink24/${source.feed.repo}/collaborators/glink25`, 'DELETE')
  await save(b, `权限恢复 ${trial}`)
  await expect.poll(async () => (await active(b)).status, { timeout: 60000 }).toBe('attention')
  assert((await active(b)).pending.length > 0)
  const permissionInvite = await api('glink24', `/repos/glink24/${source.feed.repo}/collaborators/glink25`, 'PUT', { permission: 'push' })
  if (permissionInvite?.id) await api('glink25', `/user/repository_invitations/${permissionInvite.id}`, 'PATCH')
  await sync(b); await sync(a)
  assert((await document('glink24', source.feed)).events.some(e => Object.values(e.title).includes(`权限恢复 ${trial}`)))
  record('revoked collaborator permission preserves pending edits; reauthorization and retry recover')
  const sharedEvent = (await document('glink24', source.feed)).events.find(e => Object.values(e.title).includes(`权限恢复 ${trial}`))
  await a.goto(baseURL + '/events/' + encodeURIComponent(sharedEvent.id))
  await a.getByRole('button', { name: '删除', exact: true }).click(); await synced(a); await sync(b)
  assert(!(await document('glink24', source.feed)).events.some(e => e.id === sharedEvent.id))
  await a.goto(baseURL + '/history')
  const history = a.locator('.settings-disclosure').filter({ hasText: `权限恢复 ${trial}` })
  await history.locator('summary').click()
  await history.getByRole('button', { name: '恢复', exact: true }).first().click()
  await synced(a); await sync(b)
  assert((await document('glink24', source.feed)).events.some(e => e.id === sharedEvent.id))
  record('shared event deletion and historical restoration converge across accounts')
  }
  if (process.env.AHEAD_PHASE !== 'market') {
    await create(a, `私有验证 ${trial}`, 'private'); await save(a, `私有事件 ${trial}`)
    const privateSpace = await synced(a)
    report.privateResources = { profile: privateSpace.remote, feed: privateSpace.feed }; flush()
    for (const target of [privateSpace.remote, privateSpace.feed]) {
      assert.equal((await api('glink24', `/repos/glink24/${target.repo}`)).private, true)
      await assert.rejects(api('glink25', `/repos/glink24/${target.repo}`), /HTTP 404/)
    }
    await connect(a, source.profile); await synced(a)
    assert(!(await document('glink24', source.feed)).events.some(e => Object.values(e.title).includes(`私有事件 ${trial}`)))
    record('private profile/feed reject the other account; switching to public does not publish private events')
  }
  // Publish through the actual registry workflow, never synthesize approved data.
  report.issues = []
  const existingIssues = await api('glink25', '/repos/glink25/ahead/issues?state=open&per_page=100')
  const registrations = []
  for (const resource of report.resources) {
    for (const [kind, target] of [['event-feed', resource.feed], ['user-data', resource.profile]]) {
      const title = `[Verification] ${kind} ${resource.account} ${run}`
      const issue = existingIssues.find(i => i.title === title) || await api('glink25', '/repos/glink25/ahead/issues', 'POST', {
        title,
        labels: ['type:' + kind],
        body: `### Resource type\n\n${kind}\n\n### Locator\n\ngithub:${target.owner}/${target.repo}\n\n### Manifest path\n\n${target.path}\n\nTemporary end-to-end verification using test-only data.`,
      })
      report.issues.push(issue.number); flush()
      registrations.push({ issue, account: resource.account, kind })
    }
  }
  for (const { issue, account, kind } of registrations) {
    await expect.poll(async () => (await api('glink25', `/repos/glink25/ahead/issues/${issue.number}`)).labels.map(l => l.name), { timeout: 180000, intervals: [5000] }).toContain('approved')
    record(`Market triage approved ${account} ${kind}`, { issue: issue.html_url })
  }
  // Return each account to its own profile before testing consumer behavior.
  await connect(b, report.resources[1].profile); await synced(b)
  for (let index=0; index<2; index++) {
    const consumer = pages[index], publisher = pages[1-index], resource = report.resources[1-index]
    const feed = await document(resource.account, resource.feed)
    const event = feed.events[0]
    await consumer.goto(baseURL + '/events/' + encodeURIComponent(event.id))
    await expect(consumer.getByRole('heading', { name: Object.values(event.title)[0], exact: true })).toBeVisible({ timeout: 60000 })
    if (await consumer.getByRole('button', { name: '订阅频道', exact: true }).isVisible()) await consumer.getByRole('button', { name: '订阅频道', exact: true }).click()
    await expect(consumer.getByRole('button', { name: '已订阅', exact: true })).toBeVisible()
    await consumer.goto(baseURL + '/following')
    const channel = consumer.locator('.following-card').filter({ hasText: resource.feed.repo })
    await expect(channel).toHaveCount(1)
    await channel.getByRole('combobox').selectOption('2')
    await expect.poll(async () => Object.values((await active(consumer)).records).find(r => r.collection === 'subscriptions' && r.value?.locator?.endsWith(resource.feed.repo))?.value?.priority).toBe(2)
    const available = consumer.locator('.following-card').filter({ hasText: `链路验证 ${resource.account} ${run}` }).filter({ has: consumer.getByRole('button', { name: '关注', exact: true }) })
    if (await available.count()) await available.getByRole('button', { name: '关注', exact: true }).click()
    await expect(consumer.getByRole('button', { name: '取消关注', exact: true })).toHaveCount(1)
    await synced(consumer)
    const profile = await document(accounts[index], report.resources[index].profile)
    assert(profile.subscriptions.some(s => s.kind === 'user-data' && s.locator.endsWith(resource.profile.repo)))
    assert(profile.subscriptions.some(s => s.kind === 'event-feed' && s.locator.endsWith(resource.feed.repo) && s.priority === 2))
    record(`${accounts[index]} subscribes to ${resource.account} feed and follows public profile; preferences reach GitHub`)
    await consumer.screenshot({ path: `${out}/${accounts[index]}-following.png`, fullPage: true })
    await save(publisher, `发布更新 ${resource.account} ${trial}`); await synced(publisher)
    await consumer.goto(baseURL + '/mine')
    await expect(consumer.locator('.timeline-row').filter({ hasText: `发布更新 ${resource.account} ${trial}` })).toHaveCount(1, { timeout: 60000 })
    record(`${accounts[index]} receives a new publisher commit without re-registering the source`)
    await consumer.goto(baseURL + '/events/' + encodeURIComponent(event.id))
    await expect(consumer.getByRole('button', { name: /^(喜爱|取消喜爱)$/ })).toBeVisible({ timeout: 60000 })
    if (await consumer.getByRole('button', { name: '喜爱', exact: true }).isVisible()) await consumer.getByRole('button', { name: '喜爱', exact: true }).click()
    await expect(consumer.getByRole('button', { name: '取消喜爱', exact: true })).toBeVisible(); await synced(consumer)
    await consumer.goto(baseURL + '/following')
    await consumer.getByRole('button', { name: '取消关注', exact: true }).click()
    await expect(consumer.getByRole('button', { name: '取消关注', exact: true })).toHaveCount(0)
    await consumer.locator('.following-card').filter({ hasText: resource.feed.repo }).getByRole('button', { name: '取消订阅' }).click()
    await expect(consumer.locator('.following-card').filter({ hasText: resource.feed.repo })).toHaveCount(0)
    await synced(consumer)
    const removed = await document(accounts[index], report.resources[index].profile)
    assert(!removed.subscriptions.some(s => s.locator.endsWith(resource.profile.repo) || s.locator.endsWith(resource.feed.repo)))
    assert(removed.favorites.includes(event.id))
    record(`${accounts[index]} unfollow/unsubscribe persist without removing individual favorites`)
  }
  const anon = await browser.newContext(), anonymousPage = await anon.newPage()
  const publicFeed = await document('glink24', source.feed)
  await anonymousPage.goto(baseURL + '/events/' + encodeURIComponent(publicFeed.events[0].id))
  await expect(anonymousPage.getByRole('heading', { name: Object.values(publicFeed.events[0].title)[0], exact: true })).toBeVisible({ timeout: 60000 })
  record('anonymous visitor reads a published event through the live public loader')
  await anon.close()
  for (const number of report.issues) await api('glink25', `/repos/glink25/ahead/issues/${number}`, 'PATCH', { state: 'closed' })
  record('temporary market listings closed; reproducible repositories retained')
  for (let i=0;i<pages.length;i++) await pages[i].screenshot({ path: `${out}/${accounts[i]}-result.png`, fullPage: true })
  report.status = 'passed'; flush()
} catch (error) {
  report.status = 'failed'; report.error = String(error)
  for (let i=0;i<pages.length;i++) {
    try { const s = await active(pages[i]); report[`state${i}`] = { status: s.status, error: s.error, remote: s.remote, feed: s.feed, pending: s.pending.length };
      report[`page${i}`] = await pages[i].locator('body').innerText();
      await pages[i].getByRole('link', { name: '设置', exact: true }).click();
      await pages[i].locator('#diagnostics summary').click();
      report[`diagnostics${i}`] = await pages[i].locator('.profile-view').innerText();
    } catch {}
  }
  flush(); console.error(report.error); process.exitCode = 1
} finally { await browser.close() }
