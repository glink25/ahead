import type { AuthProvider } from './types.js'

export interface AuthRegistry {
  register(provider: AuthProvider): AuthRegistry
  get(id: string): AuthProvider | undefined
  list(): AuthProvider[]
  available(): AuthProvider[]
}

export function createAuthRegistry(initialProviders: Iterable<AuthProvider> = []): AuthRegistry {
  const providers = new Map<string, AuthProvider>()

  const registry: AuthRegistry = {
    register(provider) {
      providers.set(provider.id, provider)
      return registry
    },
    get(id) {
      return providers.get(id)
    },
    list() {
      return [...providers.values()]
    },
    available() {
      return [...providers.values()].filter((provider) => provider.available)
    },
  }

  for (const provider of initialProviders) {
    registry.register(provider)
  }

  return registry
}
