'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Game = { fixture_id: string; starts_at: string; division: string; home: string; away: string; sheets?: number; state?: string; status?: string; referee?: string }
type Ops = {
  missing_sheets: Game[]
  unverified: Game[]
  not_ended: Game[]
  pending_reports: Game[]
  unfilled: Game[]
  suspensions: { player: string; team: string | null; reason: string; left: number; code?: string | null }[]
  corrections: { id: string; fixture_id: string; kind: string; detail: string; home: string; away: string; created_at: string }[]
  /** L-22 (0190): forfeits asked for, waiting on the club or the league. */
  forfeits?: { id: string; fixture_id: string; reason: string; status: string; entry: string | null; home: string; away: string; starts_at: string; created_at: string }[]
  change_requests: number
  flowing_until: string | null
}

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })

/**
 * L-26: the league's live list on a match weekend.
 *
 * Sheets missing from games played, scores waiting on one side or disputed,
 * games not ended, referee reports outstanding, games without a referee this
 * week, suspensions being served, open corrections. Each row is the game.
 * Rendered only for somebody who runs an area of the competition; nothing
 * for a club or a parent.
 */
export function MatchDayDashboard({ competitionId }: { competitionId: string }) {
  const [ops, setOps] = useState<Ops | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('match_day_ops', { p_competition: competitionId })
      if (!live) return
      setOps((data as unknown as Ops | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [competitionId])

  if (!ops) return null

  const rows: { label: string; items: Game[]; tint: string }[] = [
    { label: 'Sheets missing', items: ops.missing_sheets, tint: 'var(--no)' },
    { label: 'Scores to resolve', items: ops.unverified, tint: 'var(--no)' },
    { label: 'Not ended yet', items: ops.not_ended, tint: 'var(--maybe)' },
    { label: 'Referee reports due', items: ops.pending_reports, tint: 'var(--maybe)' },
    { label: 'No referee this week', items: ops.unfilled, tint: 'var(--maybe)' },
  ]
  const forfeits = ops.forfeits ?? []
  const total = rows.reduce((n, r) => n + r.items.length, 0) + ops.corrections.length + forfeits.length + ops.change_requests

  return (
    <section className="mx-4 mb-3 mt-3 rounded-xl border p-3 text-sm" style={{ borderColor: total > 0 ? 'var(--maybe)' : 'var(--line)' }} data-match-day-ops>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left">
        <span>
          <span className="block font-semibold">Match day</span>
          <span className="block text-xs text-ink-3">
            {total === 0
              ? 'Nothing outstanding.'
              : rows.filter((r) => r.items.length > 0).map((r) => `${r.items.length} ${r.label.toLowerCase()}`)
                  .concat(ops.corrections.length ? [`${ops.corrections.length} corrections`] : [])
                  .concat(forfeits.length ? [`${forfeits.length} forfeits asked for`] : [])
                  .concat(ops.change_requests ? [`${ops.change_requests} change requests`] : [])
                  .join(' · ')}
            {ops.suspensions.length ? ` · ${ops.suspensions.length} suspended` : ''}
            {ops.flowing_until && new Date(ops.flowing_until) > new Date() ? ` · fixture flowing open until ${when(ops.flowing_until)}` : ''}
          </span>
        </span>
        <span className="flex-none text-ink-3">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {rows.filter((r) => r.items.length > 0).map((r) => (
            <div key={r.label}>
              <span className="eyebrow" style={{ color: r.tint }}>{r.label}</span>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs">
                {r.items.map((g) => (
                  <li key={g.fixture_id}>
                    <Link href={`/competitions/${competitionId}/match/${g.fixture_id}`} className="underline decoration-dotted underline-offset-2">
                      {when(g.starts_at)} · {g.division} · {g.home} v {g.away}
                    </Link>
                    {g.sheets != null ? <span className="text-ink-3"> — {g.sheets} of 2 sheets</span> : null}
                    {g.state ? <span className="text-ink-3"> — {g.state}</span> : null}
                    {g.referee ? <span className="text-ink-3"> — {g.referee}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {ops.corrections.length > 0 && (
            <div>
              <span className="eyebrow" style={{ color: 'var(--maybe)' }}>Corrections asked for</span>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs">
                {ops.corrections.map((c) => (
                  <li key={c.id}>
                    <Link href={`/competitions/${competitionId}/match/${c.fixture_id}`} className="underline decoration-dotted underline-offset-2">
                      {c.home} v {c.away} · {c.kind}
                    </Link>
                    <span className="text-ink-3"> — {c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {forfeits.length > 0 && (
            <div>
              <span className="eyebrow" style={{ color: 'var(--no)' }}>Forfeits asked for</span>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs">
                {forfeits.map((r) => (
                  <li key={r.id}>
                    <Link href={`/competitions/${competitionId}/match/${r.fixture_id}`} className="underline decoration-dotted underline-offset-2">
                      {when(r.starts_at)} · {r.entry ?? '?'} · {r.home} v {r.away}
                    </Link>
                    <span className="text-ink-3"> — {r.status === 'club_approved' ? 'club agrees, your call' : 'waiting for the club'} · {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ops.suspensions.length > 0 && (
            <div>
              <span className="eyebrow">Suspended</span>
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs">
                {ops.suspensions.map((s, i) => (
                  <li key={i}>{s.player}{s.team ? ` (${s.team})` : ''} — {s.reason}, {s.left} {s.left === 1 ? 'game' : 'games'} to serve</li>
                ))}
              </ul>
            </div>
          )}
          {ops.change_requests > 0 && (
            <p className="text-xs text-ink-3">{ops.change_requests} change {ops.change_requests === 1 ? 'request' : 'requests'} waiting — under Clubs.</p>
          )}
        </div>
      )}
    </section>
  )
}
