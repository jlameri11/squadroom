'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const supabase = createClient()
      // RLS returns competitions you organise or your club has entered, so
      // there is nothing to filter by academy here — and a competition
      // SPANS tenants, which is why it is not scoped to one.
      const { data: comps } = await supabase
        .from('competitions')
        .select('id, name, season, status, academies!competitions_organiser_id_fkey(name)')
        .neq('status', 'ended')
        .order('created_at', { ascending: false })
        .limit(4)

      if (!live || !comps) return setRows([])

      // One round trip per competition, for at most four. Counting fixtures
      // in the same query would need an aggregate PostgREST cannot express
      // without a view, and four small counts beat a migration here.
      const withProgress = await Promise.all(
        comps.map(async (c) => {
          const [{ count: total }, { count: played }, { data: divisions }] = await Promise.all([
            supabase
              .from('fixtures')
              .select('id', { count: 'exact', head: true })
              .eq('competition_id', c.id),
            supabase
              .from('fixtures')
              .select('id', { count: 'exact', head: true })
              .eq('competition_id', c.id)
              .eq('status', 'final'),
            supabase.from('competition_entries').select('division').eq('competition_id', c.id),
          ])
          const organiser = Array.isArray(c.academies) ? c.academies[0] : c.academies
          return {
            id: c.id,
            name: c.name,
            season: c.season,
            organiser: (organiser as { name?: string } | null)?.name ?? null,
            divisions: new Set((divisions ?? []).map((d) => d.division).filter(Boolean)).size,
            played: played ?? 0,
            total: total ?? 0,
          }
        })
      )

      if (live) setRows(withProgress)
    })()
    return () => {
      live = false
    }
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <section className="px-3.5 pb-5 pt-4">
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
