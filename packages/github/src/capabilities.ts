import {
  deriveCapabilitiesFromScopes,
  type AuthIdentity,
  type CapabilityReport,
} from '@ahead/core'
import { createOctokit } from './octokit.js'

export interface CapabilityProbeResult {
  identity: AuthIdentity
  capabilities: CapabilityReport
  scopes: string[]
}

export async function probeCapabilities(
  getAccessToken: () => Promise<string>,
): Promise<CapabilityProbeResult> {
  const response = await createOctokit(getAccessToken).request('GET /user')
  const scopeHeader = response.headers['x-oauth-scopes'] ?? ''
  const scopes = scopeHeader
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)

  return {
    identity: {
      login: response.data.login,
      id: response.data.id,
      ...(response.data.name ? { name: response.data.name } : {}),
      ...(response.data.avatar_url ? { avatarUrl: response.data.avatar_url } : {}),
    },
    capabilities: deriveCapabilitiesFromScopes(scopes),
    scopes,
  }
}
