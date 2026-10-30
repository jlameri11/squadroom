'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Suspension = {
  id: string
  reason: string
  games: number
  served: number
  status: 'active' | 'served' | 'overturned'
  issued_at: string
  note: string | null
  appeal_note: string | null
}
type Row = {
  player_id: string
  name: string
  club: string | null
  entry: string | null
  yellows: number
  reds: number
  blues: number
  suspensions: Suspension[]
}
type Report = {
  rules: { yellows_per_suspension: number; games_per_yellow_suspension: number; games_per_red: number }
  players: Row[]
}

/**
 * L-08: the discipline tab. Every carded player with their cards and
 * suspensions, the competition's rules, and — for the organiser — the
 * rules to edit, a suspension to add by hand (a tribunal), and an
 * overturn with a reason. A club can note an appeal on its own player's.
 */
export function DisciplineTab({
  competitionId,
  isOrganiser,
}: {
  competitionId: string
  isOrganiser: boolean
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingRules, setEditingRules] = useState(false)
  const [rules, setRules] = useState({ yellows_per_suspension: 5, games_per_yellow_suspension: 1, games_per_red: 1 })
  const [busy, setBusy] = useState<string | null>(null)
  const [overturning, setOverturning] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('discipline_report', { p_competition: competitionId })
    if (error) return setError(error.message)
    const r = data as unknown as Report
    setReport(r)
    setRules(r.rules)
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function saveRules() {
    setBusy('rules')
    setError(null)
    const { error } = await createClient()
      .from('competition_discipline_rules')
      .upsert({ competition_id: competitionId, ...rules }, { onConflict: 'competition_id' })
    setBusy(null)
    if (error) return setError(error.message)
    setEditingRules(false)
    await load()
  }

  async function overturn(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('overturn_suspension', { p_suspension: id, p_note: note })
    setBusy(null)
    if (error) return setError(error.message)
    setOverturning(null)
    setNote('')
    await load()
  }

  if (!report) return <p className="p-5 text-center text-sm text-ink-3">{error ?? 'Loading…'}</p>

  return (
    <div className="p-3.5">
      <section className="card mb-4 p-3.5">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <b>The rules</b>
            <span className="block text-ink-3">
              {report.rules.yellows_per_suspension} yellows → {report.rules.games_per_yellow_suspension}{' '}
              {report.rules.games_per_yellow_suspension === 1 ? 'game' : 'games'} · a red → {report.rules.games_per_red}{' '}
              {report.rules.games_per_red === 1 ? 'game' : 'games'}
            </span>
          </span>
          {isOrganiser && !editingRules && (
            <button onClick={() => setEditingRules(true)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
              Edit
            </button>
          )}
        </div>
        {editingRules && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {(
              [
                ['yellows_per_suspension', 'Yellows per suspension'],
                ['games_per_yellow_suspension', 'Games for that'],
                ['games_per_red', 'Games for a red'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <span className="text-ink-2">{label}</span>
                <input type="number" min={1} max={20} value={rules[k]} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
              </label>
            ))}
            <div className="col-span-3 flex gap-2">
              <button onClick={saveRules} disabled={busy === 'rules'} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Save</button>
              <button onClick={() => setEditingRules(false)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {error && (
        <p className="mb-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <h3 className="eyebrow px-1 pb-1.5">Cards and suspensions</h3>
      {report.players.length === 0 ? (
        <p className="card p-5 text-center text-sm text-ink-3">No cards yet.</p>
      ) : (
        <ul className="card overflow-hidden">
          {report.players.map((p) => {
            const active = p.suspensions.find((s) => s.status === 'active')
            return (
              <li key={p.player_id} className="border-t px-3.5 py-3 text-sm first:border-t-0" style={{ borderColor: 'var(--line-2)' }}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-ink-3">{[p.entry, p.club].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex-none text-xs tabular-nums">
                    {p.yellows > 0 && <span>🟨 {p.yellows} </span>}
                    {p.reds > 0 && <span>🟥 {p.reds} </span>}
                    {p.blues > 0 && <span>🟦 {p.blues}</span>}
                  </span>
                </div>
                {active && (
                  <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--no)' }}>
                    Suspended — {active.reason}, {active.games - active.served} of {active.games} to serve
                  </p>
                )}
                {p.suspensions.filter((s) => s.status !== 'active').map((s) => (
                  <p key={s.id} className="mt-0.5 text-xs text-ink-3">
                    {s.status === 'served' ? 'Served' : 'Overturned'} — {s.reason}, {s.games} {s.games === 1 ? 'game' : 'games'}
                    {s.note ? ` · ${s.note}` : ''}
                  </p>
                ))}
                {active?.appeal_note && <p className="mt-0.5 text-xs text-ink-3">Appeal: {active.appeal_note}</p>}
                {isOrganiser && active && overturning !== active.id && (
                  <button onClick={() => setOverturning(active.id)} className="mt-1 text-xs underline underline-offset-2 text-ink-3">
                    Overturn
                  </button>
                )}
                {isOrganiser && active && overturning === active.id && (
                  <div className="mt-1.5 flex gap-1.5">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — the record keeps it" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }} />
                    <button onClick={() => overturn(active.id)} disabled={busy === active.id || !note.trim()} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Overturn</button>
                    <button onClick={() => setOverturning(null)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
