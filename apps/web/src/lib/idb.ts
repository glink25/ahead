/** Minimal promise wrapper over a single-store IndexedDB database. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  update<T>(key: string, change: (value: T | undefined) => T): Promise<T>
  keys(): Promise<string[]>
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result)
    source.onerror = () => reject(source.error)
  })
}

export function createIdbStore(dbName: string, storeName: string): KeyValueStore {
  let connection: Promise<IDBDatabase> | undefined

  function open(): Promise<IDBDatabase> {
    connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return connection
  }

  async function transact<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await open()
    const transaction = database.transaction(storeName, mode)
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
      transaction.onerror = () => reject(transaction.error)
    })
    const [result] = await Promise.all([request(run(transaction.objectStore(storeName))), completed])
    return result
  }

  return {
    async get<T>(key: string) {
      return (await transact<T | undefined>('readonly', (store) => store.get(key) as IDBRequest<T | undefined>))
    },
    async set(key, value) {
      await transact('readwrite', (store) => store.put(value, key))
    },
    async delete(key) {
      await transact('readwrite', (store) => store.delete(key))
    },
    async update<T>(key: string, change: (value: T | undefined) => T): Promise<T> {
      const database = await open()
      return new Promise<T>((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        let result: T
        let cause: unknown
        const read = store.get(key)
        read.onsuccess = () => {
          try { result = change(read.result); store.put(result, key) }
          catch (error) { cause = error; tx.abort() }
        }
        tx.oncomplete = () => resolve(result)
        tx.onabort = () => reject(cause ?? tx.error ?? new Error('Local transaction aborted'))
        tx.onerror = () => reject(tx.error)
      })
    },
    async keys() {
      const keys = await transact<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
      return keys.map(String)
    },
  }
}
