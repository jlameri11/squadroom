'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Row = {
  team_id: string
  name: string
  age_group: string | null
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  last: ('W' | 'D' | 'L')[]
  latest: { event_id: string; opponent: string | null; ours: number; theirs: number; starts_at: string } | null
}

const TINT = { W: 'var(--yes)', D: 'var(--maybe)', L: 'var(--no)' } as const

/**
 * X-07: every squad's season on one screen — the club championship, easy to
 * find. Read by anyone in the club; written by nobody here.
 */
export function AcademyTable({ academyId }: { academyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('academy_results', { p_academy: academyId })
      if (live) setRows(error ? null : ((data as unknown as Row[]) ?? []))
    })()
    return () => {
      live = false
    }
  }, [academyId])

  if (!rows) return null
  const withResults = rows.filter((r) => r.played > 0)
  if (withResults.length === 0) return null
  return (
    <details className="mx-4 mb-3 rounded-xl border" style={{ borderColor: 'var(--line)' }} data-academy-table>
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
        Results across the club <span className="font-normal text-ink-3">· {withResults.length} {withResults.length === 1 ? 'squad' : 'squads'}</span>
      </summary>
      <div className="overflow-x-auto border-t" style={{ borderColor: 'var(--line-2)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[0.6875rem] text-ink-3">
              <th className="px-3 py-1.5 text-left font-semibold">Squad</th>
              <th className="px-1 py-1.5 text-center font-semibold">P</th>
              <th className="px-1 py-1.5 text-center font-semibold">W</th>
              <th className="px-1 py-1.5 text-center font-semibold">D</th>
              <th className="px-1 py-1.5 text-center font-semibold">L</th>
              <th className="px-1 py-1.5 text-center font-semibold">GF–GA</th>
              <th className="px-2 py-1.5 text-left font-semibold">Form</th>
            </tr>
          </thead>
          <tbody>
            {withResults.map((r, i) => (
              <tr key={r.team_id} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line-2)' }} data-table-team={r.team_id}>
                <td className="px-3 py-1.5">
                  <Link href={`/admin/teams/${r.team_id}`} className="font-medium">{r.name}</Link>
                  {r.latest && <span className="block text-[0.6875rem] text-ink-3">Last: {r.latest.ours}–{r.latest.theirs}{r.latest.opponent ? ` v ${r.latest.opponent}` : ''}</span>}
                </td>
                <td className="px-1 py-1.5 text-center tabular-nums">{r.played}</td>
                <td className="px-1 py-1.5 text-center tabular-nums">{r.won}</td>
                <td className="px-1 py-1.5 text-center tabular-nums">{r.drawn}</td>
                <td className="px-1 py-1.5 text-center tabular-nums">{r.lost}</td>
                <td className="px-1 py-1.5 text-center tabular-nums">{r.gf}–{r.ga}</td>
                <td className="px-2 py-1.5">
                  <span className="flex gap-0.5">
                    {[...r.last].reverse().map((o, k) => (
                      <span key={k} className="grid h-5 w-5 place-items-center rounded text-[0.625rem] font-bold text-white" style={{ background: TINT[o] }}>{o}</span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
