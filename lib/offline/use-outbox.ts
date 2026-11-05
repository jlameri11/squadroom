'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { idbStore } from './idb'
import { classify, drain, enqueue, queuedFor, type DrainReport, type Queued, type SendResult, type Write } from './outbox'
import { OWNER_KEY, ownerOnThisPhone, type Remembered } from './owner'

/**
 * Sending a write that may have to wait.
 *
 * The one entry point for the taps that happen at a ground: an RSVP in a car
 * park, a register on a touchline, a goal on the sideline. Everything else in
 * the app writes normally, because everything else is done sitting down.
 *
 * Tries immediately. On a network failure it queues and reports back that it
 * was queued, so a screen can say "saved, will send when you have signal"
 * rather than either lying about success or showing an error for something
 * that is not lost. On a refusal it does NOT queue: the database has an
 * opinion and the person needs to hear it now.
 *
 * WHAT THE FIRST REAL TEST FOUND (5 Nov 2026, a browser with its signal cut):
 *
 *   · Every write with no signal was refused as "Not signed in" — finding out
 *     who was signed in asked the server. It now asks the phone (owner.ts).
 *   · A write made the moment signal came back went straight out, AHEAD of
 *     the ones still waiting: "out" tapped in the car park and "in" tapped at
 *     the gate arrived as "in" then "out". A write never overtakes one that is
 *     waiting now — it joins the end of the queue and the queue is sent.
 *   · A phone showing bars that carry nothing never fails a request, it just
 *     never answers, and the tap sat "busy" for as long as the browser cared
 *     to wait. A send now waits SEND_WAIT_MS and then keeps the write.
 */
export type SendOutcome =
  | { status: 'sent' }
  | { status: 'queued'; id: string }
  | { status: 'refused'; error: string }

/**
 * How long a send waits for an answer before the write is kept instead. A
 * healthy request takes a fraction of a second, and a weak one a second or
 * two; past this, it is a phone with no real signal, and a coach whose next
 * tap is the next goal cannot wait for it.
 *
 * KNOWN LIMIT: a request that reached the database but whose answer was lost
 * is sent again from the queue. For an RSVP or a register that is the same
 * answer twice; for a score tap it is a goal twice, which the coach sees and
 * can correct with a word. Making taps idempotent needs a client id on
 * live_tick — a migration, filed for the day the Supabase token is back.
 */
export const SEND_WAIT_MS = 6000

const OUTBOX_LOCK = 'squadroom-outbox'

async function perform(write: Write): Promise<{ error: unknown }> {
  const client = createClient()
  const stop = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // Resolves when the wait is up, whether or not the request ever started:
  // supabase-js may first be trying to refresh the session, with no signal.
  const late = new Promise<{ error: unknown }>((resolve) => {
    timer = setTimeout(() => {
      stop.abort()
      resolve({ error: { name: 'AbortError', message: 'No answer in time (timeout)' } })
    }, SEND_WAIT_MS)
  })
  const request = (async (): Promise<{ error: unknown }> => {
    if (write.kind === 'rpc') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await client.rpc(write.fn as any, write.args as any).abortSignal(stop.signal)
      return { error }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (client.from(write.table as any) as any)
      .upsert(write.rows, { onConflict: write.onConflict })
      .abortSignal(stop.signal)
    return { error }
  })()
  try {
    return await Promise.race([request, late])
  } finally {
    clearTimeout(timer)
  }
}

const remembered: Remembered = {
  get() {
    try {
      return localStorage.getItem(OWNER_KEY)
    } catch {
      return null
    }
  },
  set(id) {
    try {
      if (id) localStorage.setItem(OWNER_KEY, id)
      else localStorage.removeItem(OWNER_KEY)
    } catch {
      // A private window: the session itself still answers while it is fresh.
    }
  },
}

/**
 * Who is signed in on this phone, asked of the phone (owner.ts) — for keeping
 * a write and for naming its author in the row it writes. Never for sending
 * anything as anyone: the drain wants a live session for that (sessionNow).
 */
export function signedInHere(): Promise<string | null> {
  return ownerOnThisPhone(() => createClient().auth.getSession(), remembered)
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Keep it, and make sure it really was kept: a private window keeps nothing. */
async function keep(profileId: string, write: Write): Promise<SendOutcome> {
  const item = await enqueue(idbStore, profileId, write)
  const kept = (await idbStore.all()).some((i) => i.id === item.id)
  notify()
  if (!kept) {
    return {
      status: 'refused',
      error: 'No signal, and this browser could not keep it (a private window keeps nothing). Try again with signal.',
    }
  }
  return { status: 'queued', id: item.id }
}

/**
 * Send now or not at all, within the same wait — for what must not be kept:
 * an undo has only its minute, and one that arrives later is refused.
 */
export async function sendNow(write: Write): Promise<SendResult> {
  const { error } = await perform(write)
  return error ? classify(error) : { ok: true }
}

export async function sendOrQueue(write: Write): Promise<SendOutcome> {
  const profileId = await signedInHere()

  // Nobody signed in. Queuing would mean a write with no owner, and the owner
  // is what stops it replaying as somebody else later.
  if (!profileId) return { status: 'refused', error: 'Not signed in' }

  // Offline before even trying, which the browser usually knows. Saves a
  // doomed request and the second or two it takes to fail.
  if (offline()) return await keep(profileId, write)

  // Never ahead of a write still waiting: to the back of the queue, and the
  // queue goes now, in order.
  if (queuedFor(await idbStore.all(), profileId).length > 0) {
    const kept = await keep(profileId, write)
    void drainOutbox()
    return kept
  }

  const { error } = await perform(write)
  if (!error) return { status: 'sent' }

  const verdict = classify(error)
  if (verdict.ok) return { status: 'sent' }
  if (!verdict.retry) return { status: 'refused', error: verdict.error }

  return await keep(profileId, write)
}

/**
 * Replay everything queued for whoever is signed in.
 *
 * One drain at a time — in this tab, and across tabs where the browser has
 * Web Locks. "Back online" and "app back in front" can fire together, and
 * two drains read the same queue and send the same write twice. An RSVP is
 * an upsert and shrugs that off; a live score tap is not, and a goal sent
 * twice is two goals (5 Nov 2026, when score taps joined the outbox).
 *
 * A drain asked for while one is running is not lost: the running one goes
 * round again when it finishes, so a write queued in the middle of a drain is
 * sent by it rather than waiting for the next time the phone comes online.
 */
let draining: Promise<DrainReport | null> | null = null
let again = false

/**
 * Whoever the phone's session says is signed in now — and nobody if it cannot
 * say within a moment. No fallback to the person remembered, unlike
 * signedInHere: this is the moment writes go out AS somebody, and a write sent
 * without a live session goes as nobody and is refused, and dropped. Not
 * `getUser()` either: that asks the auth server while holding Supabase's
 * lock, and one request that never answers holds it for every other write.
 * Each write still carries the session's token, which the database checks.
 */
const forgetNobody: Remembered = { get: () => null, set: () => {} }
function sessionNow(): Promise<string | null> {
  return ownerOnThisPhone(() => createClient().auth.getSession(), forgetNobody)
}

async function drainOnce(): Promise<DrainReport | null> {
  const run = async (): Promise<DrainReport | null> => {
    const me = await sessionNow()
    if (!me) return null
    remembered.set(me)
    const report = await drain(idbStore, me, async (write) => {
      const { error } = await perform(write)
      return error ? classify(error) : { ok: true }
    })
    if (report.dropped.length) notDone.push(...report.dropped.map((d) => d.error))
    return report
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? await locks.request(OUTBOX_LOCK, run) : await run()
}

export function drainOutbox(): Promise<DrainReport | null> {
  // A doomed try, with no signal; it would only hold the lock.
  if (offline()) return Promise.resolve(null)
  if (draining) {
    again = true
    return draining
  }
  draining = (async () => {
    try {
      let report: DrainReport | null = null
      do {
        again = false
        report = await drainOnce()
      } while (again && !offline())
      return report
    } finally {
      draining = null
      notify()
    }
  })()
  return draining
}

/**
 * Take back a write that has not gone yet — a slip undone before it ever left
 * the phone, so it never reaches anybody. False when it had already gone (a
 * drain sent it in the same instant), and the caller undoes it the usual way.
 *
 * Under the drain's own lock, so the answer is true when it is given: the
 * write is either still here and now never will be sent, or it has been.
 */
export async function unqueue(id: string): Promise<boolean> {
  const take = async () => {
    const there = (await idbStore.all()).some((i) => i.id === id)
    if (there) await idbStore.remove(id)
    return there
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  let took: boolean
  if (locks) {
    took = await locks.request(OUTBOX_LOCK, take)
  } else {
    await draining?.catch(() => null)
    took = await take()
  }
  notify()
  return took
}

// A plain event, so any screen showing the queue updates without threading a
// callback through every component that might write.
const listeners = new Set<() => void>()
function notify() {
  for (const l of listeners) l()
}

/**
 * What the database refused when a kept write was finally sent — said once,
 * by the bar at the top, so a person is told rather than left guessing.
 */
const notDone: string[] = []

/** The refusals since last asked, and a way to put them away. One reader: the bar. */
export function useNotDone(): [string[], () => void] {
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => {
    const pick = () => {
      const fresh = notDone.splice(0, notDone.length)
      if (fresh.length) setErrors((was) => [...was, ...fresh])
    }
    listeners.add(pick)
    void Promise.resolve().then(pick)
    return () => {
      listeners.delete(pick)
    }
  }, [])
  return [errors, () => setErrors([])]
}

/** This person's writes still on the phone, oldest first, kept current. */
export function useQueued(): Queued[] {
  const [items, setItems] = useState<Queued[]>([])

  useEffect(() => {
    let live = true
    const refresh = async () => {
      const owner = await signedInHere()
      const all = owner ? queuedFor(await idbStore.all(), owner) : []
      if (live) setItems(all)
    }
    listeners.add(refresh)
    void refresh()
    return () => {
      live = false
      listeners.delete(refresh)
    }
  }, [])

  return items
}

/**
 * How many writes are waiting, and a drain whenever the connection returns.
 *
 * Mounted once, in the shell. `online` is not reliable on its own — a phone
 * can report online while still on a captive portal — so it also drains on
 * becoming visible again, which is what actually happens when somebody takes
 * their phone out of their pocket after the game, and every half minute while
 * anything is waiting: a try with no answer costs a write nothing.
 */
export function useOutbox() {
  const queued = useQueued()
  const count = queued.length

  useEffect(() => {
    const attempt = () => {
      void drainOutbox()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt()
    }

    window.addEventListener('online', attempt)
    document.addEventListener('visibilitychange', onVisible)
    // And once on mount, for the app being opened fresh with a queue in it.
    attempt()

    return () => {
      window.removeEventListener('online', attempt)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const waiting = count > 0
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void drainOutbox()
    }, 30_000)
    return () => clearInterval(timer)
  }, [waiting])

  return count
}
