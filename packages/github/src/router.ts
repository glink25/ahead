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

export interface RepositoryRouterOptions {
  authAdapter: RepositoryAdapter
  cdnAdapter: RepositoryAdapter
  isAuthenticated: () => boolean | Promise<boolean>
}

export function createRepositoryRouter(options: RepositoryRouterOptions): RepositoryAdapter {
  async function publicRead<T>(
    locator: ResourceLocator,
    readFromCdn: () => Promise<T>,
    readWithAuth: () => Promise<T>,
  ): Promise<T> {
    try {
      return await readFromCdn()
    } catch (error) {
      if (await options.isAuthenticated()) {
        return readWithAuth()
      }
      throw error
    }
  }

  async function requireAuth(): Promise<void> {
    if (!await options.isAuthenticated()) {
      throw new Error('Authentication is required for repository writes')
    }
  }

  return {
    inspect(locator: ResourceLocator): Promise<RepositorySnapshot> {
      return publicRead(
        locator,
        () => options.cdnAdapter.inspect(locator),
        () => options.authAdapter.inspect(locator),
      )
    },
    readFile(
      locator: ResourceLocator,
      path: string,
      opts?: { ref?: string },
    ): Promise<VersionedFile> {
      return publicRead(
        locator,
        () => options.cdnAdapter.readFile(locator, path, opts),
        () => options.authAdapter.readFile(locator, path, opts),
      )
    },
    readTree(locator: ResourceLocator, ref: string): Promise<TreeEntry[]> {
      return publicRead(
        locator,
        () => options.cdnAdapter.readTree(locator, ref),
        () => options.authAdapter.readTree(locator, ref),
      )
    },
    async commitFiles(input: CommitFilesInput): Promise<CommitResult> {
      await requireAuth()
      return options.authAdapter.commitFiles(input)
    },
    async createRepository(input: CreateRepositoryInput): Promise<RepositoryRef> {
      await requireAuth()
      return options.authAdapter.createRepository(input)
    },
  }
}
