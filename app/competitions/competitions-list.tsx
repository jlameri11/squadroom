'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'

export type CompRow = {
  id: string
  name: string
  type: string
  season: string | null
  status: string
  /** The organiser's name: its own row when readable, else the competition's text. */
  runBy: string | null
}

type Runs = {
  id: string
  name: string
  type: string
  season: string | null
  status: string
  starts_on: string | null
  ends_on: string | null
  clubs: number
  teams: number
  weekend: number
  unfilled: number
  disputed: number
  missing_sheets: number
}
type Overview = { group: { id: string; name: string; type: string }; competitions: Runs[] }

/**
 * The competitions a person can see.
 *
 * What their organisation RUNS comes first, as one overview with this
 * week's numbers (0246 group_overview): an organiser group — Magic Group,
 * running the SPL and three tournaments — sees everything it runs in one
 * place, and the people who run them are the owners, admins and
 * league-role holders, which the database decides. Then what the
 * organisation has ENTERED, as plain rows. A parent or coach gets the rows
 * alone; the overview is null for them and nothing of it shows.
 */
export function CompetitionsList({ comps }: { comps: CompRow[] }) {
  const org = useCurrentOrg()
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('group_overview', { p_academy: org.id })
      if (live) setOverview((data as unknown as Overview | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [org])

  const runs = overview?.competitions ?? []
  const runIds = new Set(runs.map((c) => c.id))
  const entered = comps.filter((c) => !runIds.has(c.id))

  return (
    <div className="p-4">
      {comps.length === 0 && (
        <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Nothing yet. A competition you enter, or one you run, appears here.
        </p>
      )}

      {overview && runs.length > 0 && <GroupOverview overview={overview} />}

      {runs.length > 0 && entered.length > 0 && (
        <div className="sect mt-5">
          <span className="eyebrow">Entered</span>
        </div>
      )}

      {entered.map((c) => (
        <Link
          key={c.id}
          href={`/competitions/${c.id}`}
          className="flex items-center gap-3 border-b border-[var(--line-2)] px-1 py-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="block truncate text-sm text-ink-2">
              <span className="capitalize">{c.type.replace('_', ' ')}</span>
              {/* The organiser's own row is withheld from another club's
                  people by policy; the competition carries the group's name
                  for exactly that (0213 went live and a coach read nothing). */}
              {c.runBy ? ` · run by ${c.runBy}` : ''}
              {c.season ? ` · ${c.season}` : ''}
            </span>
          </span>
          {c.status === 'ended' && <span className="text-xs text-ink-3">ended</span>}
        </Link>
      ))}
    </div>
  )
}

/** Everything the group runs, one row each, with what needs it this week. */
function GroupOverview({ overview }: { overview: Overview }) {
  const live = overview.competitions.filter((c) => c.status !== 'ended')
  const ended = overview.competitions.filter((c) => c.status === 'ended')
  return (
    <section className="card p-4" data-group-overview={overview.competitions.length}>
      <div className="sect">
        <span className="eyebrow">{overview.group.name} runs</span>
        <span className="text-xs text-ink-3">
          {live.length} live{ended.length ? ` · ${ended.length} ended` : ''}
        </span>
      </div>
      {live.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">Nothing running at the moment.</p>
      ) : (
        <ul className="mt-1 flex flex-col divide-y divide-[var(--line-2)]">
          {live.map((c) => (
            <RunRow key={c.id} c={c} />
          ))}
        </ul>
      )}
      {ended.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="tap cursor-pointer text-ink-3">Ended · {ended.length}</summary>
          <ul className="mt-1 flex flex-col divide-y divide-[var(--line-2)]">
            {ended.map((c) => (
              <RunRow key={c.id} c={c} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function RunRow({ c }: { c: Runs }) {
  // Plain words, in orange only where something needs the organiser.
  const needs = [
    c.unfilled > 0 && `${c.unfilled} without a referee`,
    c.disputed > 0 && `${c.disputed} disputed`,
    c.missing_sheets > 0 && `${c.missing_sheets} team ${c.missing_sheets === 1 ? 'sheet' : 'sheets'} missing`,
  ].filter((x): x is string => Boolean(x))
  return (
    <li>
      <Link href={`/competitions/${c.id}`} className="block py-2.5" data-runs={c.id}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate font-semibold">{c.name}</span>
          <span className="flex-none text-xs text-ink-3">{c.season ?? ''}</span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-2">
          {[
            `${c.clubs} ${c.clubs === 1 ? 'club' : 'clubs'}`,
            `${c.teams} ${c.teams === 1 ? 'team' : 'teams'}`,
            `${c.weekend} this weekend`,
          ].join(' · ')}
        </span>
        {needs.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {needs.map((n) => (
              <span key={n} className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                {n}
              </span>
            ))}
          </span>
        )}
      </Link>
    </li>
  )
}
