'use client'

import type { Queued, Store } from './outbox'

/**
 * IndexedDB, for the two things that have to survive a reload.
 *
 * The outbox (writes made with no signal) and the last answer each screen
 * gave (so arriving at a ground with no bars still shows the fixtures).
 * `useScreen`'s existing cache is a Map, which dies with the tab — and the
 * moment that matters most is the one where somebody has just reopened the
 * app at the ground.
 *
 * EVERY CALL CAN FAIL AND NONE OF THEM THROW. A private window refuses
 * IndexedDB outright, Safari evicts it, and a quota can be full. The app has
 * to work without any of this: offline support that breaks the online case
 * is worse than none.
 */

const DB = 'squadroom'
const VERSION = 1
const OUTBOX = 'outbox'
const SCREENS = 'screens'

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(SCREENS)) db.createObjectStore(SCREENS)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      // Safari has been known to never fire either handler when storage is
      // blocked. A screen that waits forever for its cache is worse than one
      // that just fetches.
      setTimeout(() => resolve(null), 2000)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(storeName, mode)
          const req = body(tx.objectStore(storeName))
          req.onsuccess = () => resolve(req.result ?? null)
          req.onerror = () => resolve(null)
          tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      })
  )
}

/** The outbox, as the pure logic in ./outbox expects it. */
export const idbStore: Store = {
  async all() {
    return (await run<Queued[]>(OUTBOX, 'readonly', (s) => s.getAll())) ?? []
  },
  async put(item) {
    await run(OUTBOX, 'readwrite', (s) => s.put(item) as IDBRequest<IDBValidKey>)
  },
  async remove(id) {
    await run(OUTBOX, 'readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
  },
}

/**
 * The last answer a screen gave.
 *
 * Stamped with a time so a screen can decide whether to trust it. Nothing is
 * ever evicted on a schedule: a fixtures list from last Tuesday is still the
 * right thing to show somebody standing at a ground with no signal, and the
 * fresh copy replaces it the moment one arrives.
 */
export type CachedScreen = { data: unknown; at: number }

export async function readScreen(key: string): Promise<CachedScreen | null> {
  return await run<CachedScreen>(SCREENS, 'readonly', (s) => s.get(key))
}

export async function writeScreen(key: string, data: unknown): Promise<void> {
  await run(SCREENS, 'readwrite', (s) =>
    s.put({ data, at: Date.now() } satisfies CachedScreen, key) as IDBRequest<IDBValidKey>
  )
}

/**
 * Everything, gone.
 *
 * Called on sign-out. A cached home screen is somebody's children's names and
 * their fixtures, and leaving it in the browser of a device that has been
 * handed on is the kind of thing this product cannot afford. The outbox goes
 * with it — a queued write belongs to the session that made it.
 */
export async function clearOffline(): Promise<void> {
  await run(OUTBOX, 'readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>)
  await run(SCREENS, 'readwrite', (s) => s.clear() as unknown as IDBRequest<undefined>)
}
