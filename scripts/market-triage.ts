import { appendFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { createValidator, type SchemaName } from '../packages/schema/src/index.ts'
import { parseLocator } from '../packages/protocol/src/index.ts'
import { parseYaml } from '../packages/protocol/src/yaml.ts'
import {
  APPROVED_LABEL,
  EVENT_FEED_TYPE_LABEL,
  NEEDS_CHANGES_LABEL,
  USER_DATA_TYPE_LABEL,
} from '../packages/market/src/labels.ts'
import {
  MARKET_MANIFEST_END,
  MARKET_MANIFEST_START,
  parseMarketIssueBody,
  serializeManifestBlock,
  serializeSourceBlock,
} from '../packages/market/src/format.ts'
import type { MarketSourceMetadata } from '../packages/market/src/types.ts'

const token = process.env.GITHUB_TOKEN
const repository = process.env.GITHUB_REPOSITORY
const issueNumber = process.env.ISSUE_NUMBER

async function github(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
}

async function getIssueBody(): Promise<string> {
  if (process.env.ISSUE_BODY) return process.env.ISSUE_BODY
  if (!repository || !issueNumber || !token) {
    throw new Error('请设置 ISSUE_BODY，或提供 GITHUB_REPOSITORY、ISSUE_NUMBER 与 GITHUB_TOKEN')
  }
  const response = await github(`/repos/${repository}/issues/${issueNumber}`)
  if (!response.ok) throw new Error(`读取 Issue 失败：HTTP ${response.status}`)
  return ((await response.json()) as { body?: string }).body ?? ''
}

function field(body: string, heading: string): string | undefined {
  const match = new RegExp(`###\\s+${heading}\\s*\\n+([^\\n]+)`, 'iu').exec(body)
  return match?.[1]?.trim()
}

function parseSubmission(body: string): MarketSourceMetadata {
  const existing = parseMarketIssueBody(body)
  if (existing) return existing.source
  const locator = field(body, 'Locator') ?? body.match(/github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/u)?.[0]
  if (!locator) throw new Error('Issue 中未找到有效 Locator')
  const manifestPath = field(body, 'Manifest path') ?? 'ahead.yaml'
  const resourceType = /user[\s-]*data/iu.test(body) ? 'user-data' : 'event-feed'
  return { schema: 1 as const, locator, manifestPath, resourceType }
}

async function fetchManifest(locator: string, path: string): Promise<string> {
  const parsed = parseLocator(locator)
  if (parsed.scheme !== 'github' || !('owner' in parsed)) {
    throw new Error(`暂不支持 Locator：${locator}`)
  }
  const response = await github(`/repos/${parsed.owner}/${parsed.repo}/contents/${path}`)
  if (!response.ok) throw new Error(`读取 ${path} 失败：HTTP ${response.status}`)
  const payload = (await response.json()) as { content?: string; encoding?: string }
  if (!payload.content || payload.encoding !== 'base64') throw new Error('GitHub API 未返回文件内容')
  return Buffer.from(payload.content.replace(/\n/gu, ''), 'base64').toString('utf8')
}

function replaceManifest(body: string, sourceBlock: string, manifestBlock: string): string {
  const start = body.indexOf(MARKET_MANIFEST_START)
  const end = body.indexOf(MARKET_MANIFEST_END)
  const withoutManifest = start >= 0 && end >= start
    ? `${body.slice(0, start)}${body.slice(end + MARKET_MANIFEST_END.length)}`
    : body
  const withoutSource = withoutManifest.replace(/<!--\s*ahead:source:\{[\s\S]*?\}\s*-->/gu, '').trim()
  return `${withoutSource}\n\n${sourceBlock}\n${manifestBlock}\n`
}

async function updateIssue(labels: string[], body?: string): Promise<void> {
  if (!token || !repository || !issueNumber) return
  await github(`/repos/${repository}/issues/${issueNumber}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels }),
  })
  if (body) {
    await github(`/repos/${repository}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    })
  }
}

async function main() {
  const issueBody = await getIssueBody()
  try {
    const source = parseSubmission(issueBody)
    const manifest = await fetchManifest(source.locator, source.manifestPath ?? 'ahead.yaml')
    const document = parseYaml<{ kind?: string }>(manifest)
    const schemaName: SchemaName = document.kind === 'user-data' ? 'user-data' : 'event-feed'
    if (source.resourceType !== document.kind) {
      throw new Error(`提交类型 ${source.resourceType} 与 manifest kind ${document.kind ?? '缺失'} 不一致`)
    }
    const result = createValidator().validate(schemaName, document)
    if (!result.ok) {
      throw new Error(result.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ') ?? 'Schema 校验失败')
    }

    const labels = [
      APPROVED_LABEL,
      schemaName === 'user-data' ? USER_DATA_TYPE_LABEL : EVENT_FEED_TYPE_LABEL,
    ]
    const body = replaceManifest(
      issueBody,
      serializeSourceBlock(source),
      serializeManifestBlock(manifest),
    )
    await updateIssue(labels, body)
    await output({ ok: true, labels, manifestBlock: serializeManifestBlock(manifest), dryRun: !token })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateIssue([NEEDS_CHANGES_LABEL])
    await output({ ok: false, labels: [NEEDS_CHANGES_LABEL], error: message, dryRun: !token })
    process.exitCode = 1
  }
}

async function output(result: Record<string, unknown>) {
  console.log(JSON.stringify(result, null, 2))
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `result=${JSON.stringify(result)}\n`)
  }
}

void main()
