/**
 * Writes that happened when there was no signal.
 *
 * X-09. A Saturday morning at a suburban ground is the worst network
 * conditions this product will ever meet and the most important twenty
 * minutes it has: a coach taking the register with forty parents on the same
 * tower, a parent marking a child out in a car park under a grandstand. A
 * tap that silently does nothing there is the tap that loses the club's
 * trust in the whole app.
 *
 * So a failed write is KEPT, not reported and discarded, and replayed when
 * the connection comes back.
 *
 * THE LOGIC IS PURE AND THE STORAGE IS AN INTERFACE, deliberately. The real
 * implementation is IndexedDB, which cannot be reasoned about in a test
 * without a browser — and the parts worth getting right here are the ordering
 * rules, the retry cap, and who a queued write belongs to. Those are decided
 * in this file and tested against an in-memory store.
 */

export type Write =
  | { kind: 'rpc'; fn: string; args: Record<string, unknown> }
  | {
      kind: 'upsert'
      table: string
      rows: Record<string, unknown>[]
      onConflict?: string
    }

export type Queued = {
  id: string
  /**
   * Who was signed in when this was queued.
   *
   * Checked before replay. Without it, a coach handing their phone to an
   * assistant — or a shared club tablet — would replay one person's queued
   * register as the other, and "who marked this child present" would have
   * the wrong answer. The database would mostly refuse it, but a queue that
   * relies on being refused is a queue nobody can reason about.
   */
  profileId: string
  write: Write
  queuedAt: number
  attempts: number
  /** The last thing that went wrong, for the screen that shows the queue. */
  lastError?: string
}

export interface Store {
  all(): Promise<Queued[]>
  put(item: Queued): Promise<void>
  remove(id: string): Promise<void>
}

/**
 * Five. A write that has failed five times is not failing because of the
 * network: it is a request the database refuses, and replaying it forever
 * means a queue that never drains and a badge that never clears. The same
 * number the push queue uses, for the same reason.
 *
 * ONLY ANSWERS COUNT (5 Nov 2026). A try that got no answer at all — no
 * signal, a phone showing bars that carry nothing — says nothing about the
 * write, and counting those meant a goal tapped in a dead spot was thrown
 * away after five glances at the phone. A game is an hour with no signal; the
 * write waits for as long as that takes.
 */
export const MAX_ATTEMPTS = 5

export type SendResult =
  | { ok: true }
  /**
   * Keep it and try again later. `network` when no answer came back at all —
   * no signal, a request that never left the phone, or one that timed out —
   * which costs the write nothing (see MAX_ATTEMPTS).
   */
  | { ok: false; retry: true; error: string; network?: boolean }
  /** The database said no. Trying again will not help. */
  | { ok: false; retry: false; error: string }

export type DrainReport = {
  sent: number
  /** Still queued — the network is still down, or they are waiting their turn. */
  kept: number
  /** Given up on, with why, so a person can be told rather than left guessing. */
  dropped: { id: string; write: Write; error: string }[]
}

export function newId(): string {
  // Time-ordered, so `all()` comes back in the order things were tapped even
  // in a store that does not promise an order. A coach marking Leo present
  // and then absent must not replay the other way round.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function enqueue(
  store: Store,
  profileId: string,
  write: Write
): Promise<Queued> {
  const item: Queued = {
    id: newId(),
    profileId,
    write,
    queuedAt: Date.now(),
    attempts: 0,
  }
  await store.put(item)
  return item
}

/**
 * Send everything queued for this person, oldest first.
 *
 * STOPS AT THE FIRST NETWORK FAILURE rather than trying the rest. If the
 * connection is down, the second write will fail for the same reason as the
 * first, and burning an attempt on each one means five writes reach the cap
 * while the person is still in the car park. A write refused by the database
 * is a different thing and does not stop the queue — it is dropped and the
 * rest go on.
 *
 * ORDER MATTERS AND IS PRESERVED. Two taps on the same child are two writes,
 * and replaying them out of order leaves the first answer standing.
 */
export async function drain(
  store: Store,
  profileId: string,
  send: (write: Write) => Promise<SendResult>
): Promise<DrainReport> {
  const report: DrainReport = { sent: 0, kept: 0, dropped: [] }

  const mine = queuedFor(await store.all(), profileId)

  // Somebody else's queued writes are left where they are, not replayed and
  // not thrown away: that person may sign back in on this device.
  let offline = false

  for (const item of mine) {
    if (offline) {
      report.kept += 1
      continue
    }

    const result = await send(item.write)

    if (result.ok) {
      await store.remove(item.id)
      report.sent += 1
      continue
    }

    if (result.retry) {
      // No answer at all costs nothing; an answer that says "not now" does.
      const attempts = result.network ? item.attempts : item.attempts + 1
      if (attempts >= MAX_ATTEMPTS) {
        await store.remove(item.id)
        report.dropped.push({ id: item.id, write: item.write, error: result.error })
      } else {
        await store.put({ ...item, attempts, lastError: result.error })
        report.kept += 1
      }
      // The connection is down. Everything after this would fail the same
      // way and burn an attempt doing it.
      offline = true
      continue
    }

    // Refused, not failed. Keeping it would mean a queue that never drains.
    await store.remove(item.id)
    report.dropped.push({ id: item.id, write: item.write, error: result.error })
  }

  return report
}

/**
 * This person's writes, in the order they were tapped — the order they are
 * sent in, and the order a screen shows them waiting in.
 */
export function queuedFor(items: Queued[], profileId: string): Queued[] {
  return items
    .filter((i) => i.profileId === profileId)
    .sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id))
}

/** How many of this person's writes are still waiting. */
export async function pending(store: Store, profileId: string): Promise<number> {
  return queuedFor(await store.all(), profileId).length
}

/**
 * Is this failure the network, or a refusal?
 *
 * The distinction is the whole behaviour of the queue, and supabase-js
 * reports both through the same shape. A fetch that never reached a server
 * has no HTTP status; a PostgREST error has a code. Anything unrecognised is
 * treated as RETRYABLE, because keeping a write too long is recoverable and
 * dropping one is not.
 */
/**
 * A refusal in words a parent can act on (the "Feels instant" brief: "roll
 * back with a clear message"). The database's own sentences — the ones our
 * functions raise, like "Under 13s don't have their own login" — are kept;
 * Postgres's internal ones ("new row violates row-level security policy for
 * table …") are not something to show at a football ground.
 */
export function plainRefusal(message: string, code?: string): string {
  const m = message.trim()
  if (/row-level security|permission denied|not allowed|42501/i.test(m) || code === '42501') {
    return "This account isn't allowed to do that. If that's wrong, ask your coach or the club."
  }
  if (/duplicate key|already exists|23505/i.test(m) || code === '23505') return 'That was already saved.'
  if (/violates (check|foreign key|not-null) constraint|null value in column|invalid input syntax|23502|23503|23514|22P02/i.test(m)) {
    return "That didn't save — something about it the club's rules don't allow. Try again, or ask the club."
  }
  if (/^(PGRST|JWT|FetchError|TypeError)/i.test(m) || m.length > 160) return "That didn't save. Try again in a moment."
  return m
}

export function classify(error: unknown): SendResult {
  if (!error) return { ok: true }

  const e = error as { message?: string; code?: string; status?: number; name?: string }
  const message = e.message ?? String(error)

  // PostgREST and Postgres both answer with a code. 5-digit SQLSTATEs and
  // PGRST* are the database having an opinion, which no amount of waiting
  // changes — except 57014 (statement timeout) and 08* (connection), which
  // are the database being busy rather than unwilling.
  if (e.code) {
    const transient =
      e.code === '57014' || e.code.startsWith('08') || e.code === 'PGRST504'
    return transient
      ? { ok: false, retry: true, error: message }
      : { ok: false, retry: false, error: plainRefusal(message, e.code) }
  }

  // No code at all: a TypeError from fetch, an abort, a timeout — no answer
  // came back, which says nothing about the write itself.
  if (
    e.name === 'TypeError' ||
    e.name === 'AbortError' ||
    /fetch|network|timeout|offline|abort/i.test(message)
  ) {
    return { ok: false, retry: true, error: message, network: true }
  }

  if (typeof e.status === 'number' && e.status >= 500) {
    return { ok: false, retry: true, error: message }
  }

  return { ok: false, retry: true, error: message }
}
