import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createValidator, type EventFeed, type UserData } from '../packages/schema/src/index.ts'
import { parseLocator, manifestPath } from '../packages/protocol/src/index.ts'
import { parseYaml } from '../packages/protocol/src/yaml.ts'
import { APPROVED_LABEL, EVENT_FEED_TYPE_LABEL, NEEDS_CHANGES_LABEL, USER_DATA_TYPE_LABEL } from '../packages/market/src/labels.ts'
import { parseMarketIssueBody, serializeSourceBlock } from '../packages/market/src/format.ts'
import type { MarketSourceMetadata } from '../packages/market/src/types.ts'

function field(body: string, heading: string): string | undefined {
  return new RegExp('###\\s+' + heading + '\\s*\\n+([^\\n]+)', 'iu').exec(body)?.[1]?.trim()
}

export function parseSubmission(body: string): MarketSourceMetadata {
  const previous = parseMarketIssueBody(body)?.source
  const locator = field(body, 'Locator') ?? previous?.locator
  if (!locator || !/^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(locator)) throw new Error('无效的 GitHub Locator')
  const path = manifestPath(field(body, 'Manifest path') ?? previous?.manifestPath)
  const resourceType = field(body, 'Resource type') ?? previous?.resourceType ?? 'event-feed'
  if (resourceType !== 'event-feed' && resourceType !== 'user-data') throw new Error('无效资源类型')
  return { schema: 1, locator, manifestPath: path, resourceType }
}

export function registryBody(body: string, source: MarketSourceMetadata): string {
  const clean = body.replace(/<!--\s*ahead:manifest:start\s*-->[\s\S]*?<!--\s*ahead:manifest:end\s*-->/gu, '')
    .replace(/<!--\s*ahead:source:\{[\s\S]*?\}\s*-->/gu, '').trim()
  return clean + '\n\n' + serializeSourceBlock(source) + '\n'
}

export async function main() {
  const token = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  const issueNumber = process.env.ISSUE_NUMBER
  const writable = Boolean(token && repository && issueNumber && process.env.DRY_RUN !== '1')
  const github = async (path: string, init?: RequestInit) => {
    const response = await fetch('https://api.github.com' + path, {
      ...init, headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...init?.headers },
    })
    if (!response.ok) throw new Error('GitHub HTTP ' + response.status + ': ' + path)
    return response
  }
  const issuePath = '/repos/' + repository + '/issues/' + issueNumber
  const issue = repository && issueNumber
    ? await (await github(issuePath)).json() as { body?: string; labels: { name: string }[] }
    : { body: process.env.ISSUE_BODY, labels: [] }
  if (!issue.body) throw new Error('缺少 Issue body 或仓库/Issue 编号')
  const update = async (ok: boolean, source?: MarketSourceMetadata, error?: string) => {
    if (!writable) return
    const latest = await (await github(issuePath)).json() as typeof issue
    if (latest.body !== issue.body) throw new Error('Issue 已变化，请重新运行审核')
    const managed = new Set<string>([APPROVED_LABEL, NEEDS_CHANGES_LABEL, EVENT_FEED_TYPE_LABEL, USER_DATA_TYPE_LABEL])
    const labels = latest.labels.map((label) => label.name).filter((label) => !managed.has(label))
    labels.push(ok ? APPROVED_LABEL : NEEDS_CHANGES_LABEL)
    const kind = source?.resourceType ?? (latest.labels.some((l) => l.name === USER_DATA_TYPE_LABEL) ? 'user-data' : 'event-feed')
    labels.push(kind === 'event-feed' ? EVENT_FEED_TYPE_LABEL : USER_DATA_TYPE_LABEL)
    await github(issuePath, { method: 'PATCH', body: JSON.stringify({ labels, ...(ok && source ? { body: registryBody(issue.body!, source) } : {}) }) })
    if (error) await github(issuePath + '/comments', { method: 'POST', body: JSON.stringify({ body: '市场校验未通过：\n\n' + error }) })
  }
  try {
    const source = parseSubmission(issue.body)
    if (!field(issue.body, 'Resource type') && !parseMarketIssueBody(issue.body) && issue.labels.some((l) => l.name === USER_DATA_TYPE_LABEL)) source.resourceType = 'user-data'
    const parsed = parseLocator(source.locator)
    if (!('owner' in parsed)) throw new Error('仅支持 GitHub')
    const base = '/repos/' + parsed.owner + '/' + parsed.repo
    const repo = await (await github(base)).json() as { private: boolean; default_branch: string }
    if (repo.private) throw new Error('市场仅接受公开仓库')
    const commit = await (await github(base + '/commits/' + encodeURIComponent(repo.default_branch))).json() as { sha: string }
    const encodedPath = source.manifestPath!.split('/').map(encodeURIComponent).join('/')
    const payload = await (await github(base + '/contents/' + encodedPath + '?ref=' + commit.sha)).json() as { content?: string; encoding?: string }
    if (!payload.content || payload.encoding !== 'base64') throw new Error('Manifest 不是可读取的文件')
    const document = parseYaml<EventFeed | UserData>(Buffer.from(payload.content, 'base64').toString('utf8'))
    const result = createValidator().validate(source.resourceType, document)
    if (!result.ok) throw new Error(result.errors?.map((e) => e.instancePath + ' ' + e.message).join('; ') ?? 'Schema 校验失败')
    const metadata: MarketSourceMetadata = {
      ...source, validatedSha: commit.sha, validatedAt: new Date().toISOString(),
      name: document.kind === 'event-feed' ? document.name : document.displayName,
      description: document.kind === 'event-feed' ? document.description : document.bio,
      ...(document.kind === 'event-feed' ? { tags: document.tags?.map((tag) => tag.id) } : {}),
    }
    await update(true, metadata)
    const output = { ok: true, source: metadata, dryRun: !writable }
    console.log(JSON.stringify(output, null, 2))
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'result=' + JSON.stringify(output) + '\n')
  } catch (reason) {
    await update(false, undefined, reason instanceof Error ? reason.message : String(reason))
    throw reason
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { console.error(error); process.exitCode = 1 })
}
