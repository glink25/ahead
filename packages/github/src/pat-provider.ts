import type {
  AuthCredential,
  AuthProvider,
  AuthSession,
  TokenStore,
} from '@ahead/core'
import { probeCapabilities } from './capabilities.js'

export interface PersonalAccessTokenInput {
  token: string
}

export class PersonalAccessTokenProvider implements AuthProvider {
  readonly id = 'github-pat'
  readonly kind = 'manual'
  readonly available = true
  private session: AuthSession | null = null
  private scopes: string[] = []

  constructor(private readonly tokenStore: TokenStore) {}

  async authenticate(input?: unknown): Promise<AuthSession> {
    const token = (input as PersonalAccessTokenInput | undefined)?.token?.trim()
    if (!token) {
      throw new Error('A GitHub personal access token is required')
    }

    const probe = await probeCapabilities(async () => token)
    await this.tokenStore.set(token)
    this.scopes = probe.scopes
    this.session = {
      providerId: this.id,
      identity: probe.identity,
      capabilities: probe.capabilities,
    }
    return this.session
  }

  async restore(): Promise<AuthSession | null> {
    const token = await this.tokenStore.get()
    if (!token) return null

    try {
      const probe = await probeCapabilities(async () => token)
      this.scopes = probe.scopes
      this.session = {
        providerId: this.id,
        identity: probe.identity,
        capabilities: probe.capabilities,
      }
      return this.session
    } catch (error) {
      if ((error as { status?: number })?.status !== 401) throw error
      await this.tokenStore.clear()
      this.session = null
      this.scopes = []
      return null
    }
  }

  async getCredential(): Promise<AuthCredential> {
    const token = await this.tokenStore.get()
    if (!token) {
      throw new Error('No GitHub personal access token is stored')
    }
    return {
      accessToken: token,
      tokenType: 'github-pat',
      ...(this.scopes.length ? { scopes: this.scopes } : {}),
    }
  }

  async logout(): Promise<void> {
    await this.tokenStore.clear()
    this.session = null
    this.scopes = []
  }
}
