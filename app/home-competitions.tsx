'use client'

import Link from 'next/link'
import { getOrg } from '@/lib/org'
import { useScreen } from '@/lib/hooks/use-screen'

type Row = {
  id: string
  name: string
  season: string | null
  organiser: string | null
  divisions: number
  played: number
  total: number
}

/**
 * The competitions you are in, on the home screen.
 *
 * This is the half of the product that competes with Dribl directly, and it
 * was two taps deep under Admin — a place a parent never goes and a coach
 * only goes when they have decided to do admin. A ladder is the thing people
 * open a football app to look at.
 *
 * Shows progress rather than a ladder. A top-three table per division would
 * be four competitions' worth of tables on a phone, and the interesting
 * number before you tap is how far through the season it is: "72 of 90
 * played" tells a parent whether the ladder is worth looking at yet.
 */
export function HomeCompetitions() {
  // One call (0274, as the caller: the competitions you organise or your
  // club has entered — a competition SPANS tenants, so it is not scoped to
  // one), cached like the rest of Home. This used to be a request for the
  // competitions and three more for each of them, thirteen in two rounds,
  // on every open (time-screens, 13 Nov 2026).
  const { data: rows } = useScreen<Row[]>('home_competitions', { p_academy: getOrg() ?? undefined })

  if (!rows || rows.length === 0) return null

  return (
    <section className="px-3.5 pb-5 pt-4" data-home-competitions={rows.length}>
      <div className="sect">
        <span className="eyebrow">Competitions</span>
        <Link href="/competitions" className="text-xs text-ink-3 underline underline-offset-2">
          All
        </Link>
      </div>

      <div className="card overflow-hidden">
        {rows.map((c) => (
          <Link key={c.id} href={`/competitions/${c.id}`} className="row justify-between">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-sm text-ink-3">
                {[
                  c.organiser,
                  c.divisions > 0 && `${c.divisions} division${c.divisions === 1 ? '' : 's'}`,
                  c.total > 0 ? `${c.played} of ${c.total} played` : 'no draw yet',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>

            {/* A bar, because "72 of 90" is a number and how-far-through is a
                shape. */}
            {c.total > 0 && (
              <span
                className="h-1.5 w-12 flex-none overflow-hidden rounded-full"
                style={{ background: 'var(--surface-2)' }}
                aria-hidden
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.round((c.played / c.total) * 100)}%`,
                    background: 'var(--brand)',
                  }}
                />
              </span>
            )}
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
