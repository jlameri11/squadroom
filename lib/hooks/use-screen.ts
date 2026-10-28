'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { readScreen, writeScreen } from '@/lib/offline/idb'

/**
 * Fetch a screen's data from the BROWSER rather than the server.
 *
 * Where everyone is decides this. Netlify runs the app in us-east-2 and
 * Supabase is in Sydney, so a server-rendered page pays a 250ms Pacific
 * crossing before it can draw anything — and the people using it are in
 * Sydney, a few milliseconds from that same database. Rendering on the server
 * was making an Australian club pay for an American detour on every tap.
 *
 * So the server does only the auth check, which getClaims answers locally for
 * free, and hands over a shell. The shell paints immediately; the data lands
 * on the next frame.
 *
 * It is also what CLAUDE.md meant by client-first: every rule lives in the
 * database, so which side asks makes no difference to what comes back.
 */
/**
 * What each screen last returned, kept for the life of the tab.
 *
 * Without it, every navigation re-fetched from nothing and showed a skeleton —
 * including going back to a screen you were looking at four seconds ago. That
 * flash, not the wait, is what "slow between pages" actually is: 60ms of
 * fetching looks like a reload if the screen empties first.
 *
 * Stale-while-revalidate. The cached answer paints instantly and a fresh one
 * replaces it when it lands, so a tab switch is immediate and still current
 * within a frame or two.
 */
const cache = new Map<string, unknown>()

/**
 * And the same thing again, on disk.
 *
 * The Map above dies with the tab, and the moment that matters most is the
 * one where somebody has just reopened the app at a ground with no signal.
 * X-09: a fixtures list from Tuesday is the right thing to show a parent
 * standing at a gate on Saturday, and a skeleton is not.
 *
 * It only ever fills a screen that has nothing. A fresh answer always wins,
 * and a stale one is never written over a newer one — `seen` is what stops a
 * slow disk read landing after the network has already answered.
 */
const seen = new Set<string>()

export function useScreen<T>(fn: string, args?: Record<string, unknown>) {
  const key = fn + ':' + JSON.stringify(args ?? {})
  const [data, setData] = useState<T | null>(() => (cache.get(key) as T) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    // Show whatever we had for this screen immediately, even if this is a
    // different instance of the component than the one that fetched it.
    const cached = cache.get(key)
    if (cached !== undefined) setData(cached as T)
    else {
      // Nothing in memory. Ask the disk, but never let the answer overwrite
      // a network reply that has already landed.
      void readScreen(key).then((hit) => {
        if (!live || !hit || seen.has(key) || cache.get(key) !== undefined) return
        cache.set(key, hit.data)
        setData(hit.data as T)
      })
    }
    const call = async () => {
      const client = createClient()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = await client.rpc(fn as any, args as any)

      // PGRST202 is "no function with that argument list". It happens when a
      // screen passes p_academy and 0080 — which adds the parameter — has not
      // been applied to this database yet. Dropping the argument and asking
      // again gets the person their default organisation, which is exactly
      // what the app did before the switcher existed.
      //
      // Deletable in one block once every environment is past 0080.
      if (first.error?.code === 'PGRST202' && args && 'p_academy' in args) {
        const rest = { ...args }
        delete rest.p_academy
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return client.rpc(fn as any, rest as any)
      }
      return first
    }

    call()
      .then(({ data, error }: { data: unknown; error: { code?: string } | null }) => {
        if (!live) return

        // These screens no longer check the session on the server, so this is
        // where a signed-out visitor is turned away. Every screen RPC returns
        // null when auth.uid() is null, and PostgREST answers 401 when the
        // token is missing or expired — both mean the same thing here.
        const unauthenticated = data === null || error?.code === 'PGRST301' || error?.code === '401'
        if (unauthenticated && !error) {
          window.location.replace('/signin')
          return
        }
        if (error || data == null) {
          // A cached screen stays on display rather than being replaced by an
          // error. A flaky moment on a train should not blank the fixtures.
          if (cache.get(key) === undefined) setFailed(true)
          return
        }
        seen.add(key)
        cache.set(key, data)
        setData(data as T)
        // Kept for the next cold start. Failures are silent by design — a
        // private window refuses IndexedDB, and offline support that breaks
        // the online case is worse than none.
        void writeScreen(key, data)
      })
    return () => {
      live = false
    }
    // Keyed by value, not identity — an object literal in a caller would
    // otherwise re-fetch on every render.
  }, [fn, key])  // eslint-disable-line react-hooks/exhaustive-deps

  return { data, failed }
}

/**
 * Drop a screen's cached answer so the next visit refetches.
 *
 * Call after writing something that changes what a screen shows — creating a
 * chat, calling off a game — or the person is shown their own stale copy and
 * concludes the write did not work.
 */
export function invalidateScreen(fn?: string) {
  if (!fn) return cache.clear()
  for (const k of cache.keys()) if (k.startsWith(fn + ':')) cache.delete(k)
}
