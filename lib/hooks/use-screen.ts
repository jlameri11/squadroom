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

/**
 * One request per screen at a time (the "Feels instant" pass, 13 Nov 2026).
 *
 * Home starts its sections' requests before they mount, and a section that
 * mounts while its request is in flight joins it instead of asking twice —
 * the way lib/early.ts shared Home's calls, now for every screen. A prefetch
 * from Home (the four tabs, the next game, a chat row in view) is the same
 * request started early, and whoever opens that screen joins or finds it
 * cached. `fetchedAt` is what makes a prefetch skip a screen asked for moments
 * ago, and what tells a screen to ask again quietly when the tab comes back
 * after a while away.
 */
type Reply = { data: unknown; error: { code?: string; message?: string } | null }
const pending = new Map<string, Promise<Reply>>()
const fetchedAt = new Map<string, number>()
const PREFETCH_FRESH_MS = 30_000
const REVALIDATE_AFTER_MS = 30_000
const FRESH_MS = 5_000

const keyOf = (fn: string, args?: Record<string, unknown>) => fn + ':' + JSON.stringify(args ?? {})

async function call(fn: string, args?: Record<string, unknown>): Promise<Reply> {
  const client = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = (await client.rpc(fn as any, args as any)) as Reply

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
    return (await client.rpc(fn as any, rest as any)) as Reply
  }
  return first
}

/** The request for this screen, shared with anyone else asking right now; a good answer is cached and kept on disk. */
function fetchScreen(fn: string, args?: Record<string, unknown>): Promise<Reply> {
  const key = keyOf(fn, args)
  const inFlight = pending.get(key)
  if (inFlight) return inFlight
  const p = call(fn, args)
    .then((reply) => {
      if (!reply.error && reply.data != null) {
        seen.add(key)
        cache.set(key, reply.data)
        fetchedAt.set(key, Date.now())
        // Kept for the next cold start. Failures are silent by design — a
        // private window refuses IndexedDB, and offline support that breaks
        // the online case is worse than none.
        void writeScreen(key, reply.data)
      }
      return reply
    })
    .finally(() => {
      if (pending.get(key) === p) pending.delete(key)
    })
  pending.set(key, p)
  return p
}

/**
 * Start a screen's request before anyone opens it: Home does this for the
 * four tabs and the next game, the chat list for a row that scrolls into
 * view. Skipped when the screen was fetched moments ago.
 */
export function prefetchScreen(fn: string, args?: Record<string, unknown>): void {
  const key = keyOf(fn, args)
  const at = fetchedAt.get(key)
  if (at && Date.now() - at < PREFETCH_FRESH_MS) return
  void fetchScreen(fn, args).catch(() => undefined)
}

/** The cached answer, if any — for a screen that wants to seed state without a hook. */
export function peekScreen<T>(fn: string, args?: Record<string, unknown>): T | null {
  return (cache.get(keyOf(fn, args)) as T) ?? null
}

export function useScreen<T>(
  fn: string,
  args?: Record<string, unknown>,
  opts: {
    /** Fetch again when this changes (after saving a layout, say); not part of the cache key. */
    revalidateKey?: unknown
    /** False to ask for nothing yet (a section a person may not have). */
    enabled?: boolean
  } = {}
) {
  const key = keyOf(fn, args)
  const enabled = opts.enabled !== false
  const [data, setData] = useState<T | null>(() => (enabled ? ((cache.get(key) as T) ?? null) : null))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
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

    const take = (reply: Reply) => {
      if (!live) return
      const { data, error } = reply
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
        // A failure with no session is a signed-out visitor, not a bad
        // connection: PostgREST answers a missing token with an error
        // body, which used to read as "Couldn't load" (Joey, 4 Nov 2026).
        void createClient().auth.getSession().then(({ data: s }) => {
          if (live && !s.session) window.location.replace('/signin')
        })
        // A cached screen stays on display rather than being replaced by an
        // error. A flaky moment on a train should not blank the fixtures.
        if (cache.get(key) === undefined) setFailed(true)
        return
      }
      setData(data as T)
    }

    // An answer that landed moments ago — Home's early start, a prefetch
    // from the screen before — is the answer; asking again would be the
    // same request twice (time-screens, 13 Nov 2026). Older than that, the
    // cached copy paints and a fresh one follows.
    const at = fetchedAt.get(key)
    if (!(at && Date.now() - at < FRESH_MS && cache.get(key) !== undefined)) void fetchScreen(fn, args).then(take)

    // Back to the tab after a while away: ask again, quietly. The screen on
    // display stays until the answer lands.
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      const at = fetchedAt.get(key)
      if (at && Date.now() - at < REVALIDATE_AFTER_MS) return
      void fetchScreen(fn, args).then(take)
    }
    document.addEventListener('visibilitychange', onWake)

    return () => {
      live = false
      document.removeEventListener('visibilitychange', onWake)
    }
    // Keyed by value, not identity — an object literal in a caller would
    // otherwise re-fetch on every render.
  }, [fn, key, enabled, opts.revalidateKey])  // eslint-disable-line react-hooks/exhaustive-deps

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
  if (!fn) {
    cache.clear()
    fetchedAt.clear()
    return
  }
  for (const k of cache.keys()) if (k.startsWith(fn + ':')) cache.delete(k)
  for (const k of fetchedAt.keys()) if (k.startsWith(fn + ':')) fetchedAt.delete(k)
}
