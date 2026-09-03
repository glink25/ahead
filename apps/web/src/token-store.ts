import type { TokenStore } from '@ahead/core'

const DB_NAME = 'ahead-auth'
const STORE_NAME = 'credentials'
const TOKEN_KEY = 'github-pat'

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
  get: () => transact('readonly', (store) => store.get(TOKEN_KEY)).then((value) => value ?? null),
  set: (token) => transact('readwrite', (store) => store.put(token, TOKEN_KEY)).then(() => undefined),
  clear: () => transact('readwrite', (store) => store.delete(TOKEN_KEY)).then(() => undefined),
}
