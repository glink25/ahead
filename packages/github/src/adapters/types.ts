export type {
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

export interface GitHubCodeSearchResult {
  total_count: number
  incomplete_results: boolean
  items: {
    path: string
    repository: { name: string; owner: { login: string } }
  }[]
}

export interface GitHubSearchAdapter {
  searchCode(
    query: string,
    page?: number,
    perPage?: number,
    signal?: AbortSignal,
  ): Promise<GitHubCodeSearchResult>
}
