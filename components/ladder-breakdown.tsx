'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'

export type Breakdown = {
  entry_id: string
  team_name: string
  division: string
  group_label: string | null
  rules: { win: number; draw: number; loss: number; tie_break: string }
  games: { fixture_id: string; round: string | null; starts_at: string | null; stage: string | null; home: boolean; opponent: string; ours: number; theirs: number; result: 'W' | 'D' | 'L'; points: number; forfeit: boolean }[]
  adjustments: { points: number; reason: string; made_at: string }[]
  totals: { played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; goal_difference: number; from_games: number; from_adjustments: number; points: number }
}

const WORD: Record<'W' | 'D' | 'L', string> = { W: 'won', D: 'drew', L: 'lost' }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '')

/**
 * Part C item 6 (0260): tap a ladder row, see every point. The games in
 * order with the score, the result and the points the division gives for
 * it; a forfeit named; the adjustments with their reasons; the sum the
 * ladder shows. One sheet for the league's page and the public centre —
 * what differs is only how the breakdown is fetched.
 */
export function LadderBreakdownSheet({ teamName, fetchBreakdown, onClose }: {
  teamName: string
  fetchBreakdown: () => Promise<Breakdown | null>
  onClose: () => void
}) {
  const [data, setData] = useState<Breakdown | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    ;(async () => {
      const b = await fetchBreakdown().catch(() => null)
      if (live) setData(b)
    })()
    return () => {
      live = false
    }
  }, [fetchBreakdown])

  const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
  return (
    <Sheet onClose={onClose}>
      <div className="p-4" data-ladder-breakdown={data ? data.entry_id : data === null ? 'none' : 'loading'}>
        <h2 className="display text-[1.375rem] leading-tight">{teamName}</h2>
        {data === undefined && <p className="mt-2 text-sm text-ink-3">Adding it up…</p>}
        {data === null && <p className="mt-2 text-sm text-ink-3">No breakdown to show.</p>}
        {data && (
          <>
            <p className="mt-0.5 text-sm text-ink-2">
              <b className="text-ink">{data.totals.points}</b> {data.totals.points === 1 ? 'point' : 'points'} ·
              {' '}{data.totals.won}–{data.totals.drawn}–{data.totals.lost}, goals {data.totals.goals_for}–{data.totals.goals_against}
              {' '}({signed(data.totals.goal_difference)})
            </p>
            <div className="sect mt-3">
              <span className="eyebrow">Games</span>
              <span className="text-xs text-ink-3">{data.rules.win} a win · {data.rules.draw} a draw{data.rules.loss ? ` · ${data.rules.loss} a loss` : ''}</span>
            </div>
            {data.games.length === 0 ? (
              <p className="mt-1 text-sm text-ink-3">Nothing played yet.</p>
            ) : (
              <ul className="mt-1 divide-y rounded-xl border text-sm" style={{ borderColor: 'var(--line)' }}>
                {data.games.map((g) => (
                  <li key={g.fixture_id} className="flex items-center gap-2 px-3 py-2" data-breakdown-game={g.result}>
                    <span className="w-14 flex-none text-xs text-ink-3">{g.round ?? day(g.starts_at)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {WORD[g.result]} {g.ours}–{g.theirs} {g.home ? 'v' : 'at'} {g.opponent}
                    </span>
                    {g.forfeit && <span className="flex-none rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>forfeit</span>}
                    <span className="flex-none font-semibold tabular-nums" style={{ color: g.points > 0 ? 'var(--brand-text)' : 'var(--ink-3)' }}>{signed(g.points).replace('+', '+')}</span>
                  </li>
                ))}
              </ul>
            )}
            {data.adjustments.length > 0 && (
              <>
                <div className="sect mt-3">
                  <span className="eyebrow">Adjustments</span>
                  <span className="text-xs text-ink-3">by the league</span>
                </div>
                <ul className="mt-1 divide-y rounded-xl border text-sm" style={{ borderColor: 'var(--line)' }}>
                  {data.adjustments.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 px-3 py-2" data-breakdown-adjustment>
                      <span className="w-14 flex-none text-xs text-ink-3">{day(a.made_at)}</span>
                      <span className="min-w-0 flex-1">{a.reason}</span>
                      <span className="flex-none font-semibold tabular-nums" style={{ color: a.points < 0 ? 'var(--no)' : 'var(--yes)' }}>{signed(a.points)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-sm" data-breakdown-total>
              From games <b>{data.totals.from_games}</b>
              {data.totals.from_adjustments !== 0 && <> · adjustments <b>{signed(data.totals.from_adjustments)}</b></>}
              {' '}· <b>{data.totals.points}</b> {data.totals.points === 1 ? 'point' : 'points'} on the ladder
            </p>
          </>
        )}
        <button onClick={onClose} className="mt-4 w-full rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--line)' }}>Close</button>
      </div>
    </Sheet>
  )
}
