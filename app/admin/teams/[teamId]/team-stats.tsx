'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Row = { id: string; name: string; preferred_name: string | null; appearances: number; goals: number; assists: number; potm: number }

/** X-02: the squad's season at a glance — games, goals, assists, stars. */
export function TeamStats({ teamId }: { teamId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('team_season_stats', { p_team: teamId })
      if (live) setRows(error ? null : ((data as unknown as Row[]) ?? []))
    })()
    return () => {
      live = false
    }
  }, [teamId])

  if (!rows || !rows.some((r) => r.appearances > 0 || r.goals > 0)) return null
  return (
    <section className="mt-6" data-team-stats>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Season stats</h2>
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-ink-3">
              <th className="px-3 py-1.5 text-left font-semibold">Player</th>
              <th className="px-2 py-1.5 text-center font-semibold">Games</th>
              <th className="px-2 py-1.5 text-center font-semibold">Goals</th>
              <th className="px-2 py-1.5 text-center font-semibold">Assists</th>
              <th className="px-2 py-1.5 text-center font-semibold">🏆</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={i > 0 ? 'border-t' : ''} style={{ borderColor: 'var(--line-2)' }}>
                <td className="px-3 py-1.5"><Link href={`/card/${r.id}`} className="underline-offset-2 hover:underline">{r.name}</Link></td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.appearances}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.goals}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.assists}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{r.potm || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
