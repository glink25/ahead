import type { CapabilityReport } from './types.js'

export function deriveCapabilitiesFromScopes(scopes: string[]): CapabilityReport {
  const normalized = new Set(scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean))
  const hasRepo = normalized.has('repo')
  const hasPublicRepo = hasRepo || normalized.has('public_repo')
  const hasReadUser = normalized.has('read:user') || normalized.has('user')

  const missingScopes: string[] = []
  const diagnostics: string[] = []

  if (!hasRepo) {
    missingScopes.push('repo')
    diagnostics.push('缺少 repo 权限，无法读取私有仓库。')
  }

  if (!hasPublicRepo) {
    missingScopes.push('public_repo')
    diagnostics.push('缺少 public_repo 或 repo 权限，无法创建仓库或写入仓库内容。')
  }

  if (!hasReadUser) {
    missingScopes.push('read:user')
    diagnostics.push('缺少 read:user 权限，用户资料可能不完整。')
  }

  if (diagnostics.length === 0) {
    diagnostics.push('当前授权范围满足 Ahead 的全部仓库操作需求。')
  }

  return {
    canReadPublic: true,
    canReadPrivate: hasRepo,
    canCreateRepository: hasPublicRepo,
    canWriteContents: hasPublicRepo,
    canReadMarketIssues: true,
    missingScopes,
    diagnostics,
  }
}
