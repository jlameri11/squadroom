'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const SYDNEY = 'Australia/Sydney'
type Row = {
  fixture_id: string
  starts_at: string
  division: string
  venue: string | null
  field: string | null
  home: string | null
  away: string | null
  referee_id: string | null
  referee: string | null
  load: number | null
  why: string | null
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: SYDNEY })

/**
 * W-05: a day's appointments as a draft to argue with. Preview changes
 * nothing; Ask them all sends each as an ordinary offer (every rule, every
 * push) under one batch; Undo withdraws the ones nobody has accepted.
 */
export function RefereeAuto({ competitionId, onDone }: { competitionId: string; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
    return d.toLocaleDateString('en-CA', { timeZone: SYDNEY })
  })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ id: string; appointed: number; failed: { fixture_id: string; why: string }[] } | null>(null)
  const [undone, setUndone] = useState<{ undone: number; kept: number } | null>(null)

  async function preview() {
    setBusy(true)
    setError(null)
    setBatch(null)
    setUndone(null)
    const { data, error } = await createClient().rpc('propose_referee_allocation', { p_competition: competitionId, p_date: date })
    setBusy(false)
    if (error) return setError(error.message)
    setRows((data as unknown as Row[]) ?? [])
  }

  async function apply() {
    if (!rows) return
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('apply_referee_allocation', { p_competition: competitionId, p_rows: rows.filter((r) => r.referee_id).map((r) => ({ fixture_id: r.fixture_id, referee_id: r.referee_id })) })
    setBusy(false)
    if (error) return setError(error.message)
    const b = data as unknown as { batch_id: string; appointed: number; failed: { fixture_id: string; why: string }[] }
    setBatch({ id: b.batch_id, appointed: b.appointed, failed: b.failed })
    setRows(null)
    await onDone()
  }

  async function undo() {
    if (!batch) return
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('undo_referee_allocation', { p_batch: batch.id })
    setBusy(false)
    if (error) return setError(error.message)
    setUndone(data as unknown as { undone: number; kept: number })
    setBatch(null)
    await onDone()
  }

  const covered = rows?.filter((r) => r.referee_id).length ?? 0

  return (
    <section className="card mb-3 p-3.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm">
          <b>Appoint a whole day</b>
          <span className="block text-ink-3">A draft from who is free and who has had the fewest games; you decide.</span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
        <button onClick={preview} disabled={busy || !date} className="rounded-lg px-3 py-1.5 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          Preview
        </button>
      </div>
      {error && <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}

      {rows && (
        <div className="mt-3">
          {rows.length === 0 ? (
            <p className="text-xs text-ink-3">No game on that day is without a referee.</p>
          ) : (
            <>
              <ul className="divide-y text-xs" style={{ borderColor: 'var(--line-2)' }}>
                {rows.map((r) => (
                  <li key={r.fixture_id} className="flex items-center gap-2 py-1.5">
                    <span className="w-14 flex-none tabular-nums text-ink-3">{time(r.starts_at)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.home ?? 'TBC'} v {r.away ?? 'TBC'}</span>
                      <span className="block truncate text-ink-3">{[r.division, r.venue, r.field].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="flex-none text-right">
                      {r.referee ? (
                        <>
                          <span className="block font-medium">{r.referee}</span>
                          <span className="block text-ink-3">{r.load} so far</span>
                        </>
                      ) : (
                        <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{r.why}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <button onClick={apply} disabled={busy || covered === 0} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                  Ask them all ({covered} of {rows.length})
                </button>
                <button onClick={() => setRows(null)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Discard</button>
              </div>
            </>
          )}
        </div>
      )}

      {batch && (
        <div className="mt-3 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)' }}>
          <p>
            <b>{batch.appointed}</b> asked{batch.failed.length ? `; ${batch.failed.length} could not be (${batch.failed.map((f) => f.why).join('; ')})` : ''}. Each referee got a push.
          </p>
          <button onClick={undo} disabled={busy} className="mt-2 rounded-lg border px-3 py-1.5 font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
            Undo — withdraw the ones not yet accepted
          </button>
        </div>
      )}
      {undone && (
        <p className="mt-2 text-xs text-ink-3">
          {undone.undone} withdrawn{undone.kept ? `; ${undone.kept} kept because the referee had already said yes` : ''}.
        </p>
      )}
    </section>
  )
}
