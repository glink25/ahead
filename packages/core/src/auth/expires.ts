export function toExpiresAt(expiresInSeconds: number, now = Date.now()): number {
  return now + expiresInSeconds * 1_000
}

export function isExpired(expiresAt: number, skewMs = 60_000): boolean {
  return expiresAt <= Date.now() + skewMs
}
