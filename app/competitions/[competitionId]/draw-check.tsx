'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type Quality = {
  games: number
  pinned: number
  teams: { entry_id: string; name: string; games: number; home: number; away: number; early: number; late: number }[]
  pairs: { min: number; max: number; uneven: { a: string; b: string; games: number }[] }
  club_clashes: { at: string; club: string; games: string[] }[]
  double_headers: { team: string; day: string; games: number }[]
  travel: { team: string; day: string; grounds: string[] }[]
  empty_slots: { at: string; venue: string; field: string }[]
}
type Impact = { fixture_id: string; starts_at: string; division: string; round: string | null; venue: string | null; field: string | null; home: string; away: string; clubs: string[] | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })

/**
 * L-24: the sanity check before a draw goes out, and "a field is out".
 *
 * Reads the draw back the way an organiser checks it by hand — who meets
 * whom how often, home and away, the early and late slots, two teams of one
 * club at the same time, a double header, a team at two grounds in a day,
 * an empty field — and says what a closed field on a day would hit before
 * it is closed. Games moved by hand are pinned, and a rebuild keeps them.
 */
export function DrawCheck({ competitionId, division }: { competitionId: string; division: string }) {
  const [q, setQ] = useState<Quality | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState('')
  const [field, setField] = useState('')
  const [impact, setImpact] = useState<Impact[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function check() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('draw_quality', { p_competition: competitionId, p_division: division })
    setBusy(false)
    if (error) return setError(error.message)
    setQ((data as unknown as Quality | null) ?? null)
  }
  async function askImpact() {
    if (!date) return
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('field_impact', { p_competition: competitionId, p_date: date, p_field: field || undefined })
    setBusy(false)
    if (error) return setError(error.message)
    setImpact((data as unknown as Impact[] | null) ?? [])
  }

  const issues = q ? q.pairs.uneven.length + q.club_clashes.length + q.double_headers.length + q.travel.length + q.empty_slots.length : 0

  return (
    <section className="mx-4 mb-3 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }} data-draw-check>
      <div className="flex items-center justify-between gap-2">
        <span>
          <span className="block font-semibold">Check the draw</span>
          <span className="block text-xs text-ink-3">Pairs, home and away, clashes, double headers, empty slots — before it goes out.</span>
        </span>
        <button onClick={check} disabled={busy} className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          {busy ? '…' : q ? 'Check again' : 'Check'}
        </button>
      </div>

      {q && (
        <div className="mt-2">
          <p className="text-xs" style={{ color: issues === 0 ? 'var(--yes)' : 'var(--maybe)' }}>
            {q.games} games{q.pinned > 0 ? ` · ${q.pinned} moved by hand and kept on a rebuild` : ''} · {issues === 0 ? 'nothing to fix' : `${issues} ${issues === 1 ? 'thing' : 'things'} to look at`}
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-ink-2">
            <li>Each pair meets {q.pairs.min === q.pairs.max ? `${q.pairs.min}×` : `${q.pairs.min}–${q.pairs.max}×`}{q.pairs.uneven.length > 0 ? ` — uneven: ${q.pairs.uneven.map((u) => `${u.a} v ${u.b} ${u.games}×`).join(', ')}` : ''}</li>
            {q.teams.map((t) => (
              <li key={t.entry_id}>
                {t.name}: {t.games} games, {t.home} home / {t.away} away{t.early > 0 ? `, first slot ${t.early}×` : ''}{t.late > 0 ? `, last slot ${t.late}×` : ''}
              </li>
            ))}
            {q.club_clashes.map((c, i) => (
              <li key={`c${i}`} style={{ color: 'var(--no)' }}>⚠ {c.club} has two teams on at {when(c.at)}: {c.games.join('; ')}</li>
            ))}
            {q.double_headers.map((d, i) => (
              <li key={`d${i}`} style={{ color: 'var(--maybe)' }}>⚠ {d.team} plays {d.games} games on {d.day}</li>
            ))}
            {q.travel.map((t, i) => (
              <li key={`t${i}`} style={{ color: 'var(--maybe)' }}>⚠ {t.team} is at {t.grounds.join(' and ')} on {t.day}</li>
            ))}
            {q.empty_slots.map((s, i) => (
              <li key={`s${i}`} style={{ color: 'var(--maybe)' }}>⚠ {s.field} is empty at {when(s.at)}{s.venue ? ` (${s.venue})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--line-2)' }}>
        <span className="block text-xs font-semibold">A field is out?</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Day" />
          <input value={field} onChange={(e) => setField(e.target.value)} placeholder="Field (blank: all)" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} aria-label="Field" />
          <button onClick={askImpact} disabled={busy || !date} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Who is hit?</button>
        </div>
        {impact && (
          impact.length === 0 ? (
            <p className="mt-1.5 text-xs text-ink-3">No games there that day.</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-xs">
              {impact.map((g) => (
                <li key={g.fixture_id}>
                  <Link href={`/competitions/${competitionId}/match/${g.fixture_id}`} className="underline decoration-dotted underline-offset-2">
                    {when(g.starts_at)} · {g.field ?? '?'} · {g.home} v {g.away}
                  </Link>
                  {g.clubs?.length ? <span className="text-ink-3"> — {g.clubs.join(', ')}</span> : null}
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
