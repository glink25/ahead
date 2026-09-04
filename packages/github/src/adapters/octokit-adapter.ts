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
import { createOctokit, type AheadOctokit } from '../octokit.js'

function decodeBase64(content: string): string {
  const bytes = Uint8Array.from(atob(content.replace(/\n/g, '')), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export class OctokitAdapter implements RepositoryAdapter {
  private readonly octokit: AheadOctokit

  constructor(getAccessToken: () => Promise<string>) {
    this.octokit = createOctokit(getAccessToken)
  }

  async inspect(locator: ResourceLocator): Promise<RepositorySnapshot> {
    const repository = await this.octokit.request('GET /repos/{owner}/{repo}', {
      owner: locator.owner,
      repo: locator.repo,
    })
    const ref = locator.ref ?? repository.data.default_branch
    const commit = await this.octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
      owner: locator.owner,
      repo: locator.repo,
      ref,
    })

    return {
      locator,
      defaultBranch: repository.data.default_branch,
      headSha: commit.data.sha,
      committedAt: commit.data.commit.committer?.date ?? undefined,
      repositoryId: repository.data.id,
      description: repository.data.description,
      writable: repository.data.permissions?.push,
      private: repository.data.private,
    }
  }

  async listRepositories(page = 1) {
    const response = await this.octokit.request('GET /user/repos', { per_page: 100, page, sort: 'updated', affiliation: 'owner,collaborator,organization_member' })
    return response.data.map((repo) => ({
      owner: repo.owner.login, repo: repo.name, private: repo.private, repositoryId: repo.id, writable: repo.permissions?.push,
    }))
  }

  async readFile(
    locator: ResourceLocator,
    path: string,
    opts?: { ref?: string },
  ): Promise<VersionedFile> {
    const response = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: locator.owner,
      repo: locator.repo,
      path,
      ref: opts?.ref ?? locator.ref,
    })
    const data = response.data
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
      throw new Error(`GitHub path is not a file: ${path}`)
    }

    return {
      path: data.path,
      content: data.encoding === 'base64' ? decodeBase64(data.content) : data.content,
      sha: data.sha,
      encoding: data.encoding,
    }
  }

  async readTree(locator: ResourceLocator, ref: string): Promise<TreeEntry[]> {
    const response = await this.octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
      owner: locator.owner,
      repo: locator.repo,
      tree_sha: ref,
      recursive: '1',
    })

    return response.data.tree.flatMap((entry) =>
      entry.path && entry.mode && entry.sha && (
        entry.type === 'blob' || entry.type === 'tree' || entry.type === 'commit'
      )
        ? [{
            path: entry.path,
            mode: entry.mode,
            type: entry.type,
            sha: entry.sha,
            ...(entry.size === undefined ? {} : { size: entry.size }),
            ...(entry.url === undefined ? {} : { url: entry.url }),
          }]
        : [],
    )
  }

  async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
    const { owner, repo } = input.locator
    const branchRef = await this.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: `heads/${input.branch}`,
    })
    const parentSha = branchRef.data.object.sha
    if (input.expectedHeadSha && input.expectedHeadSha !== parentSha) {
      throw new Error(
        `Repository head changed: expected ${input.expectedHeadSha}, received ${parentSha}`,
      )
    }

    const parent = await this.octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
      owner,
      repo,
      commit_sha: parentSha,
    })
    const blobs = await Promise.all(
      input.files.map(async (file) => {
        const requestedMode = file.mode ?? '100644'
        if (requestedMode !== '100644' && requestedMode !== '100755') {
          throw new Error(`Unsupported file mode for ${file.path}: ${requestedMode}`)
        }
        const mode: '100644' | '100755' = requestedMode
        const blob = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
          owner,
          repo,
          content: file.content,
          encoding: 'utf-8',
        })
        return {
          path: file.path,
          mode,
          type: 'blob' as const,
          sha: blob.data.sha,
        }
      }),
    )
    const tree = await this.octokit.request('POST /repos/{owner}/{repo}/git/trees', {
      owner,
      repo,
      base_tree: parent.data.tree.sha,
      tree: blobs,
    })
    const commit = await this.octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      owner,
      repo,
      message: input.message,
      tree: tree.data.sha,
      parents: [parentSha],
    })
    await this.octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `heads/${input.branch}`,
      sha: commit.data.sha,
      force: false,
    })

    return { sha: commit.data.sha, treeSha: tree.data.sha, parentSha }
  }

  async createRepository(input: CreateRepositoryInput): Promise<RepositoryRef> {
    const response = await this.octokit.request('POST /user/repos', {
      name: input.name,
      description: input.description,
      private: input.private ?? false,
      auto_init: input.autoInit ?? false,
    })

    return {
      owner: response.data.owner.login,
      repo: response.data.name,
      defaultBranch: response.data.default_branch,
      private: response.data.private,
      htmlUrl: response.data.html_url,
    }
  }
}
