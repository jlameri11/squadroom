'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { idbStore } from './idb'
import { classify, drain, enqueue, pending, type DrainReport, type Write } from './outbox'

/**
 * Sending a write that may have to wait.
 *
 * The one entry point for the taps that happen at a ground: an RSVP in a car
 * park, a register on a touchline. Everything else in the app writes
 * normally, because everything else is done sitting down.
 *
 * Tries immediately. On a network failure it queues and reports back that it
 * was queued, so a screen can say "saved, will send when you have signal"
 * rather than either lying about success or showing an error for something
 * that is not lost. On a refusal it does NOT queue: the database has an
 * opinion and the person needs to hear it now.
 */
export type SendOutcome =
  | { status: 'sent' }
  | { status: 'queued' }
  | { status: 'refused'; error: string }

async function perform(write: Write): Promise<{ error: unknown }> {
  const client = createClient()
  if (write.kind === 'rpc') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await client.rpc(write.fn as any, write.args as any)
    return { error }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from(write.table as any) as any).upsert(write.rows, {
    onConflict: write.onConflict,
  })
  return { error }
}

export async function sendOrQueue(write: Write): Promise<SendOutcome> {
  const client = createClient()
  const { data: auth } = await client.auth.getUser()
  const profileId = auth.user?.id

  // Nobody signed in. Queuing would mean a write with no owner, and the owner
  // is what stops it replaying as somebody else later.
  if (!profileId) return { status: 'refused', error: 'Not signed in' }

  // Offline before even trying, which the browser usually knows. Saves a
  // doomed request and the second or two it takes to fail.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue(idbStore, profileId, write)
    notify()
    return { status: 'queued' }
  }

  const { error } = await perform(write)
  if (!error) return { status: 'sent' }

  const verdict = classify(error)
  if (verdict.ok) return { status: 'sent' }
  if (!verdict.retry) return { status: 'refused', error: verdict.error }

  await enqueue(idbStore, profileId, write)
  notify()
  return { status: 'queued' }
}

/** Replay everything queued for whoever is signed in. */
export async function drainOutbox(): Promise<DrainReport | null> {
  const client = createClient()
  const { data: auth } = await client.auth.getUser()
  if (!auth.user) return null

  const report = await drain(idbStore, auth.user.id, async (write) => {
    const { error } = await perform(write)
    return error ? classify(error) : { ok: true }
  })
  notify()
  return report
}

// A plain event, so any screen showing the queue updates without threading a
// callback through every component that might write.
const listeners = new Set<() => void>()
function notify() {
  for (const l of listeners) l()
}

/**
 * How many writes are waiting, and a drain whenever the connection returns.
 *
 * Mounted once, in the shell. `online` is not reliable on its own — a phone
 * can report online while still on a captive portal — so it also drains on
 * becoming visible again, which is what actually happens when somebody takes
 * their phone out of their pocket after the game.
 */
export function useOutbox() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let live = true
    const refresh = async () => {
      const client = createClient()
      const { data: auth } = await client.auth.getUser()
      if (!live || !auth.user) return
      setCount(await pending(idbStore, auth.user.id))
    }

    listeners.add(refresh)
    void refresh()

    const attempt = () => {
      void drainOutbox().then(refresh)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') attempt()
    }

    window.addEventListener('online', attempt)
    document.addEventListener('visibilitychange', onVisible)
    // And once on mount, for the app being opened fresh with a queue in it.
    attempt()

    return () => {
      live = false
      listeners.delete(refresh)
      window.removeEventListener('online', attempt)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return count
}
