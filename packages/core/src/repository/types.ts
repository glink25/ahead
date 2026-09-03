export interface ResourceLocator {
  scheme: string
  owner: string
  repo: string
  ref?: string
}

export interface RepositoryRef {
  owner: string
  repo: string
  defaultBranch: string
  private: boolean
  htmlUrl: string
}

export interface RepositorySnapshot {
  locator: ResourceLocator
  defaultBranch: string
  headSha: string
  private: boolean
}

export interface VersionedFile {
  path: string
  content: string
  sha: string
  encoding?: string
}

export interface TreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
  url?: string
}

export interface ReadFileOptions {
  ref?: string
}

export interface CommitFile {
  path: string
  content: string
  mode?: string
}

export interface CommitFilesInput {
  locator: ResourceLocator
  branch: string
  message: string
  files: CommitFile[]
  expectedHeadSha?: string
}

export interface CommitResult {
  sha: string
  treeSha: string
  parentSha: string
}

export interface CreateRepositoryInput {
  name: string
  description?: string
  private?: boolean
  autoInit?: boolean
}

export interface RepositoryAdapter {
  inspect(locator: ResourceLocator): Promise<RepositorySnapshot>
  readFile(
    locator: ResourceLocator,
    path: string,
    options?: ReadFileOptions,
  ): Promise<VersionedFile>
  readTree(locator: ResourceLocator, ref: string): Promise<TreeEntry[]>
  commitFiles(input: CommitFilesInput): Promise<CommitResult>
  createRepository(input: CreateRepositoryInput): Promise<RepositoryRef>
}
