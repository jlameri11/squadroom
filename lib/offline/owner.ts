/**
 * Who a write kept on this phone belongs to — worked out WITHOUT the network.
 *
 * Found on 5 Nov 2026, the first time the outbox was driven in a real browser
 * with the signal cut: every write tapped with no signal was refused as "Not
 * signed in". The outbox asked `auth.getUser()` who was signed in, and
 * getUser asks the auth server — the one thing a phone with no bars cannot
 * reach. RSVPs in the car park, the register on the touchline: all refused,
 * at exactly the moment they were built for. The pure tests passed because
 * they never asked.
 *
 * The session stored on the phone already names the person, and reading it
 * needs no network while its token is fresh. The database still checks the
 * token on every write when it is finally sent, and the replay only sends
 * with a live session, never on the strength of this memory (use-outbox).
 *
 * TWO WAYS THE STORED SESSION CAN STILL FAIL TO ANSWER, both on a long day
 * with no signal:
 *
 *   · Its token lasts an hour, and once it is stale reading the session means
 *     refreshing it — which needs the network, and fails.
 *   · Supabase retries that refresh for up to thirty seconds, holding its
 *     lock, so a tap would sit "busy" for half a minute while the ball is in
 *     play.
 *
 * So the last person this phone saw signed in is remembered, and used when
 * the session cannot answer within a moment. Never when it answers "nobody":
 * signed out is signed out, and the memory goes with it.
 *
 * No imports, deliberately: scripts/test-outbox.ts runs this file directly.
 */

/** Where the last person seen signed in on this phone is remembered. Cleared on sign-out. */
export const OWNER_KEY = 'squadroom.outbox.owner'

/** How long a tap waits for the stored session before trusting the memory. */
export const SESSION_WAIT_MS = 1500

export type SessionRead = {
  data: { session: { user?: { id?: string } | null } | null }
  error: unknown
}

export interface Remembered {
  get(): string | null
  set(id: string | null): void
}

export async function ownerOnThisPhone(
  read: () => Promise<SessionRead>,
  remembered: Remembered,
  waitMs: number = SESSION_WAIT_MS
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), waitMs)
  })
  try {
    const got = await Promise.race([
      read().catch((error: unknown): SessionRead => ({ data: { session: null }, error })),
      late,
    ])
    // Stuck behind a refresh that cannot finish: the person it was a moment ago.
    if (got === 'late') return remembered.get()

    const id = got.data.session?.user?.id ?? null
    if (id) {
      remembered.set(id)
      return id
    }
    // Nobody, and nothing went wrong finding that out: signed out.
    if (!got.error) {
      remembered.set(null)
      return null
    }
    // A session that could not be refreshed with no signal.
    return remembered.get()
  } finally {
    clearTimeout(timer)
  }
}
