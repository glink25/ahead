import type {
  CommitFilesInput,
  CommitResult,
  CreateRepositoryInput,
  RepositoryAdapter,
  RepositoryRef,
  RepositorySnapshot,
  ResourceLocator,
  TreeEntry,
  VersionedFile,
} from '@ahead/core'

type Fetch = typeof globalThis.fetch

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function buildJsDelivrUrl(locator: ResourceLocator, sha: string, path: string): string {
  return `https://cdn.jsdelivr.net/gh/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}@${encodeURIComponent(sha)}/${encodePath(path)}`
}

export function buildRawGitHubUrl(locator: ResourceLocator, sha: string, path: string): string {
  return `https://raw.githubusercontent.com/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/${encodeURIComponent(sha)}/${encodePath(path)}`
}

async function json<T>(response: Response, description: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${description} failed with HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export class CdnReadAdapter implements RepositoryAdapter {
  private readonly pending = new Map<string, Promise<RepositorySnapshot>>()
  constructor(private readonly fetcher: Fetch = (input, init) => globalThis.fetch(input, {
    ...init, signal: init?.signal ?? AbortSignal.timeout(15_000),
  })) {}

  async resolveHeadSha(locator: ResourceLocator, ref?: string): Promise<string> {
    const target = ref ?? locator.ref ?? 'HEAD'
    if (/^[0-9a-f]{40}$/iu.test(target)) return target
    const base = `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`
    const headers = { Accept: 'application/vnd.github+json' }
    const commitResponse = await this.fetcher(`${base}/commits/${encodeURIComponent(target)}`, {
      headers,
      cache: 'no-store',
    })
    if (commitResponse.ok) {
      return (await commitResponse.json() as { sha: string }).sha
    }

    const gitRef = `heads/${target}`
    const refResponse = await this.fetcher(`${base}/git/ref/${encodePath(gitRef)}`, { headers, cache: 'no-store' })
    const data = await json<{ object: { sha: string } }>(refResponse, 'Resolve GitHub ref')
    return data.object.sha
  }

  inspect(locator: ResourceLocator): Promise<RepositorySnapshot> {
    const key = `${locator.owner.toLowerCase()}/${locator.repo.toLowerCase()}@${locator.ref ?? 'HEAD'}`
    let pending = this.pending.get(key)
    if (!pending) {
      pending = this.inspectRepository(locator)
      this.pending.set(key, pending)
      void pending.catch(() => this.pending.delete(key))
    }
    return pending
  }

  private async inspectRepository(locator: ResourceLocator): Promise<RepositorySnapshot> {
    const url = `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`
    const repository = await json<{ default_branch: string; private: boolean }>(
      await this.fetcher(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' }),
      'Inspect GitHub repository',
    )
    const headSha = await this.resolveHeadSha(locator, locator.ref ?? repository.default_branch)
    return {
      locator,
      defaultBranch: repository.default_branch,
      headSha,
      private: repository.private,
    }
  }

  async readFile(
    locator: ResourceLocator,
    path: string,
    opts?: { ref?: string },
  ): Promise<VersionedFile> {
    const sha = await this.resolveHeadSha(locator, opts?.ref)
    const cdnResponse = await this.fetcher(buildJsDelivrUrl(locator, sha, path)).catch(() => undefined)
    const response = cdnResponse?.ok
      ? cdnResponse
      : await this.fetcher(buildRawGitHubUrl(locator, sha, path))
    if (!response.ok) {
      throw new Error(`Read public GitHub file failed with HTTP ${response.status}: ${path}`)
    }

    return { path, content: await response.text(), sha, encoding: 'utf-8' }
  }

  async readTree(locator: ResourceLocator, ref: string): Promise<TreeEntry[]> {
    const sha = await this.resolveHeadSha(locator, ref)
    const url = `https://api.github.com/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`
    const data = await json<{ tree: TreeEntry[]; truncated?: boolean }>(
      await this.fetcher(url, { headers: { Accept: 'application/vnd.github+json' } }),
      'Read public GitHub tree',
    )
    if (data.truncated) throw new Error('Repository tree truncated; narrow the feed or inline its events')
    return data.tree
  }

  commitFiles(_input: CommitFilesInput): Promise<CommitResult> {
    throw new Error('CdnReadAdapter is read-only; use an authenticated adapter to commit files')
  }

  createRepository(_input: CreateRepositoryInput): Promise<RepositoryRef> {
    throw new Error('CdnReadAdapter is read-only; use an authenticated adapter to create repositories')
  }
}
