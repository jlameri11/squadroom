'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = { team: string; ours: boolean; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number }
type Table = {
  team: { id: string; name: string; league_name?: string | null }
  division: string | null
  season: string | null
  reason?: string
  updated_at: string | null
  games: number
  rows: Row[]
}

/**
 * F-05 (0228): the division table, from the league's results file. The
 * other clubs' games in an export used to be left out as "neither team is
 * yours"; kept, they make the table — 3 for a win, 1 for a draw, goal
 * difference then goals for, the same rule as our own competitions. Shown
 * under the squad's form and on a game's Preview; nothing when there is no
 * file behind it. Team names and scores only, as the league prints them.
 */
export function DivisionTable({ teamId }: { teamId: string }) {
  const [t, setT] = useState<Table | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('division_table', { p_team: teamId })
      if (live) setT(error ? null : (data as unknown as Table))
    })()
    return () => {
      live = false
    }
  }, [teamId])

  if (!t || t.rows.length === 0) return null
  const updated = t.updated_at ? new Date(t.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null
  const cell = 'text-right tabular-nums'

  return (
    <section className="mt-6" data-division-table>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Division table</h2>
        <span className="truncate text-xs text-ink-3">
          {[t.division, t.season, updated ? `updated ${updated}` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        <div className="grid min-w-[20rem] grid-cols-[1.4rem_minmax(0,1fr)_repeat(6,1.7rem)] gap-x-1 px-2 py-1.5 text-[0.6875rem] text-ink-3" role="row">
          <span>#</span>
          <span>Team</span>
          <span className={cell}>P</span>
          <span className={cell}>W</span>
          <span className={cell}>D</span>
          <span className={cell}>L</span>
          <span className={cell}>GD</span>
          <span className={`${cell} font-semibold`}>Pts</span>
        </div>
        {t.rows.map((r, i) => (
          <div
            key={r.team}
            className="grid min-w-[20rem] grid-cols-[1.4rem_minmax(0,1fr)_repeat(6,1.7rem)] gap-x-1 border-t px-2 py-1.5 text-xs"
            style={{ borderColor: 'var(--line-2)', background: r.ours ? 'var(--surface-2)' : undefined, fontWeight: r.ours ? 600 : undefined }}
            role="row"
            data-table-row={r.ours ? 'ours' : undefined}
          >
            <span className="tabular-nums text-ink-3">{i + 1}</span>
            <span className="truncate">{r.team}</span>
            <span className={cell}>{r.p}</span>
            <span className={cell}>{r.w}</span>
            <span className={cell}>{r.d}</span>
            <span className={cell}>{r.l}</span>
            <span className={cell}>{r.gd > 0 ? `+${r.gd}` : r.gd}</span>
            <span className={`${cell} font-semibold`}>{r.pts}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-3">
        From the league&apos;s results file, {t.games} {t.games === 1 ? 'game' : 'games'} played. Three for a win, one for a draw; goal difference, then goals for.
      </p>
    </section>
  )
}
