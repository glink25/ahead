import type { TokenStore } from '@ahead/core'
import type { OAuthCredentialStore, StoredOAuthCredential } from '@ahead/github'

const DB_NAME = 'ahead-auth'
const STORE_NAME = 'credentials'
const PAT_KEY = 'github-pat'
const OAUTH_KEY = 'github-oauth'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const request = operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

export const indexedDbTokenStore: TokenStore = {
  get: () => transact('readonly', (store) => store.get(PAT_KEY)).then((value) => value ?? null),
  set: (token) => transact('readwrite', (store) => store.put(token, PAT_KEY)).then(() => undefined),
  clear: () => transact('readwrite', (store) => store.delete(PAT_KEY)).then(() => undefined),
}

export const indexedDbOAuthCredentialStore: OAuthCredentialStore = {
  get: async () => {
    const value = await transact('readonly', (store) => store.get(OAUTH_KEY))
    if (!value || typeof value !== 'object') return null
    const record = value as StoredOAuthCredential
    return record.accessToken ? record : null
  },
  set: (credential) => transact('readwrite', (store) => store.put(credential, OAUTH_KEY)).then(() => undefined),
  clear: () => transact('readwrite', (store) => store.delete(OAUTH_KEY)).then(() => undefined),
}
