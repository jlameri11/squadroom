import { createAdminClient } from '@/lib/supabase/admin'
import { MyGames, type FeedEvent } from './my-games'

/**
 * A family's fixtures, for somebody with no account.
 *
 * Children do not get accounts (0078), so this is how a fourteen-year-old
 * sees when they are playing: their parent sends them this link once and they
 * bookmark it. Same rotatable token as the calendar subscription — one
 * credential, two representations, and rotating it kills both.
 *
 * Deliberately not an app screen. No tab bar, no sign-in prompt, nothing to
 * tap that leads anywhere needing a login. The only thing on it is football.
 *
 * `calendar_feed_events` already scopes to one family's children and returns
 * no names, no phone numbers and nothing about anyone else — which is why
 * this page needed no new database work at all.
 */
export const dynamic = 'force-dynamic'

export default async function MyGamesPage(ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  // Same shape the calendar route checks. A malformed token is not an error
  // worth distinguishing from a rotated one.
  if (!/^[a-f0-9]{48}$/.test(token)) return <Gone />

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('calendar_feed_events', { p_token: token })

  // An empty list and a broken query look identical to whoever opened this,
  // and dressing a failure up as "no games" is how a family misses a match.
  if (error) {
    console.error('my-games feed failed', error)
    return (
      <Shell>
        <p className="text-center text-sm text-ink-2">
          Couldn&apos;t load your games just now. Try again in a minute.
        </p>
      </Shell>
    )
  }

  if (!data || data.length === 0) return <Gone />

  return <MyGames events={data as FeedEvent[]} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">{children}</main>
  )
}

function Gone() {
  return (
    <Shell>
      <div className="text-center">
        <p className="display text-2xl" style={{ color: 'var(--brand-text)' }}>
          Nothing here
        </p>
        <p className="mt-2 text-sm text-ink-2">
          This link has expired or been replaced. Ask whoever sent it to you for a new one.
        </p>
      </div>
    </Shell>
  )
}
