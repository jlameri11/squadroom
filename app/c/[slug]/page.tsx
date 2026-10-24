import { createClient } from '@supabase/supabase-js'
import type { Metadata } from 'next'
import { MatchCentre, type Centre } from './match-centre'

/**
 * A competition, in public, with no login.
 *
 * Children do not get accounts (0078) and they still want to know whether
 * their team won. Dribl solves this the same way — fv.dribl.com and
 * nsfa.dribl.com are ordinary public websites — and a nine-year-old opening a
 * link in Safari is the whole audience for this page.
 *
 * Clubs and scores only. Never a child's name, never a phone number, never
 * anything about a family; `public_match_centre` (0079) is a single function
 * with that boundary built in rather than policies loosened for anon, because
 * policies are additive and somebody eventually widens one.
 *
 * NO COOKIES, which is why the client is built here instead of using
 * lib/supabase/server. A cookie-reading client makes the response
 * per-request and uncacheable, and this is the one page in the product that
 * a hundred people open at 9am on a Saturday. No session, no cookie, nothing
 * stored about whoever is reading — a page a child opens should collect
 * nothing at all.
 */
export const revalidate = 60

// 60 seconds, not 0 and not an hour. Scores go in from the sideline and a
// parent refreshing wants to see them; the database would also rather answer
// once for a hundred readers than a hundred times.

async function load(slug: string): Promise<Centre | null> {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data } = await anon.rpc('public_match_centre', { p_slug: slug })
  return (data as unknown as Centre) ?? null
}

export async function generateMetadata(ctx: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await ctx.params
  const centre = await load(slug)
  if (!centre) return { title: 'Not found' }
  return {
    title: `${centre.competition.name} — fixtures, results and ladder`,
    description: `Draw, results and ladder for ${centre.competition.name}, run by ${centre.competition.organiser}.`,
    // A competition page shared into a group chat should preview properly;
    // that is how most people will arrive at it.
    openGraph: {
      title: centre.competition.name,
      description: `Fixtures, results and ladder · ${centre.competition.organiser}`,
    },
    // Nothing here is meant to be indexed and followed into the rest of the
    // product, and a competition page that outlives its season is clutter in
    // a search result.
    robots: { index: true, follow: false },
  }
}

export default async function PublicCompetitionPage(ctx: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await ctx.params
  const centre = await load(slug)

  // An unpublished competition and a wrong slug are the same answer on
  // purpose. Telling somebody "that exists but is not published" tells them
  // something about an academy they have no relationship with.
  if (!centre) {
    return (
      <main
        className="grid min-h-dvh place-items-center px-6"
        style={{ background: 'var(--paper)' }}
      >
        <div className="max-w-sm text-center">
          <p className="display text-[26px] leading-tight">Nothing here</p>
          <p className="mt-2 text-sm text-ink-2">
            This competition page isn&apos;t published, or the link has changed. Ask whoever sent
            it to you for a new one.
          </p>
        </div>
      </main>
    )
  }

  return <MatchCentre centre={centre} />
}
