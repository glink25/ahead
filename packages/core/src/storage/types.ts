export interface TokenStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}
