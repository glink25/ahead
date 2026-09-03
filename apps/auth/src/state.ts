const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('STATE_SECRET must not be empty')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFromSecret(secret),
    encoder.encode(JSON.stringify(value)),
  )
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptJson<T>(value: string, secret: string): Promise<T> {
  const [ivPart, encryptedPart, extra] = value.split('.')
  if (!ivPart || !encryptedPart || extra) throw new Error('Invalid encrypted payload')
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(ivPart) },
    await keyFromSecret(secret),
    fromBase64Url(encryptedPart),
  )
  return JSON.parse(decoder.decode(decrypted)) as T
}

export interface OAuthState {
  redirect_uri: string
  exp: number
}

export function encryptState(state: OAuthState, secret: string): Promise<string> {
  return encryptJson(state, secret)
}

export async function decryptState(
  encrypted: string,
  secret: string,
  now = Date.now(),
): Promise<OAuthState> {
  const state = await decryptJson<OAuthState>(encrypted, secret)
  if (!state.redirect_uri || !Number.isFinite(state.exp)) throw new Error('Invalid OAuth state')
  if (state.exp <= now) throw new Error('OAuth state has expired')
  return state
}
