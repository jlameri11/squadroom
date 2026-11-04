'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Game = { fixture_id: string; round: string | null; home_name: string | null; away_name: string | null; status: string; home_score: number | null; away_score: number | null; starts_at: string | null }

const REASONS: [string, string][] = [
  ['wet_weather', 'Wet weather'], ['ground_closed', 'Ground closed'], ['not_enough_players', 'Not enough players'], ['other', 'Other'],
]

/**
 * L-28: a whole round at once — scores for every game in it, the round moved
 * by some days (every family told through the mirror), or called off.
 */
export function RoundTools({ competitionId, division, fixtures, grounds }: { competitionId: string; division: string; fixtures: Game[]; grounds: boolean }) {
  const router = useRouter()
  const rounds = [...new Set(fixtures.map((f) => f.round).filter((r): r is string => Boolean(r)))]
  const [round, setRound] = useState(rounds[0] ?? '')
  const [mode, setMode] = useState<null | 'scores' | 'shift' | 'off'>(null)
  const [scores, setScores] = useState<Record<string, { h: string; a: string }>>({})
  const [days, setDays] = useState('7')
  const [reason, setReason] = useState('wet_weather')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (rounds.length === 0) return null
  const games = fixtures.filter((f) => f.round === round)
  const unplayed = games.filter((f) => !['final', 'forfeit', 'bye', 'cancelled'].includes(f.status))

  async function run(fn: 'bulk_scores' | 'shift_round' | 'abandon_round', args: Record<string, unknown>, say: (n: unknown) => string) {
    setBusy(true)
    setError(null)
    setResult(null)
    const { data, error } = await createClient().rpc(fn, args as never)
    setBusy(false)
    if (error) return setError(error.message)
    setResult(say(data))
    setMode(null)
    router.refresh()
  }

  return (
    <section className="mx-4 mb-3 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }} data-round-tools>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Round tools</span>
        <select value={round} onChange={(e) => { setRound(e.target.value); setMode(null) }} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Round">
          {rounds.map((r) => (<option key={r} value={r}>{r}</option>))}
        </select>
        <button onClick={() => setMode(mode === 'scores' ? null : 'scores')} disabled={unplayed.length === 0} className="rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-40" style={{ borderColor: 'var(--line)' }}>Scores</button>
        {grounds && <button onClick={() => setMode(mode === 'shift' ? null : 'shift')} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--line)' }}>Move</button>}
        {grounds && <button onClick={() => setMode(mode === 'off' ? null : 'off')} className="rounded-lg border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}>Call off</button>}
      </div>

      {mode === 'scores' && (
        <div className="mt-2">
          <p className="text-xs text-ink-3">Every unplayed game in {round}. Blank rows are left alone; a score makes the game final and ended.</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {unplayed.map((g) => (
              <li key={g.fixture_id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{g.home_name ?? 'TBC'} v {g.away_name ?? 'TBC'}</span>
                <input value={scores[g.fixture_id]?.h ?? ''} onChange={(e) => setScores({ ...scores, [g.fixture_id]: { h: e.target.value, a: scores[g.fixture_id]?.a ?? '' } })} inputMode="numeric" className="w-10 rounded-lg border px-1 py-1 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label={`${g.home_name} score`} />
                <span className="text-ink-3">–</span>
                <input value={scores[g.fixture_id]?.a ?? ''} onChange={(e) => setScores({ ...scores, [g.fixture_id]: { h: scores[g.fixture_id]?.h ?? '', a: e.target.value } })} inputMode="numeric" className="w-10 rounded-lg border px-1 py-1 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label={`${g.away_name} score`} />
              </li>
            ))}
          </ul>
          <button
            onClick={() => run('bulk_scores', {
              p_competition: competitionId,
              p_rows: Object.entries(scores).filter(([, s]) => s.h !== '' && s.a !== '').map(([fixture_id, s]) => ({ fixture_id, home: Number(s.h), away: Number(s.a) })),
            }, (d) => { const r = d as { updated: number; skipped: unknown[] }; return `${r.updated} scores entered${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.` })}
            disabled={busy || !Object.values(scores).some((s) => s.h !== '' && s.a !== '')}
            className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}
          >
            {busy ? '…' : 'Enter these scores'}
          </button>
        </div>
      )}

      {mode === 'shift' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span>Move every unplayed game in {round} by</span>
          <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className="w-12 rounded-lg border px-1 py-1 text-center tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Days" />
          <span>days (minus to bring forward). Every family is told.</span>
          <button onClick={() => run('shift_round', { p_competition: competitionId, p_division: division, p_round: round, p_days: Number(days) }, (n) => `${n} games moved.`)} disabled={busy || !Number(days)} className="rounded-lg px-3 py-1.5 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Move</button>
        </div>
      )}

      {mode === 'off' && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span>Call off every game in {round}:</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--line)' }} aria-label="Reason">
            {REASONS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
          </select>
          <button onClick={() => run('abandon_round', { p_competition: competitionId, p_division: division, p_round: round, p_reason: reason }, (n) => `${n} games postponed. Reschedule them when you know.`)} disabled={busy} className="rounded-lg px-3 py-1.5 font-semibold text-maybe-ink disabled:opacity-50" style={{ background: 'var(--maybe)' }}>Postpone the round</button>
        </div>
      )}

      {result && <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }}>{result}</p>}
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
