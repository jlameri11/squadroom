'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const SYDNEY = 'Australia/Sydney'
type Role = 'referee' | 'assistant' | 'fourth'
const ROLES: [Role, string][] = [['referee', 'Referee'], ['assistant', 'Assistant'], ['fourth', '4th official']]
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

type Unpaid = { appointment_id: string; referee: string; role: Role; starts_at: string | null; home: string | null; away: string | null; fee_cents: number }
type Run = {
  id: string
  period_from: string
  period_to: string
  status: 'draft' | 'paid'
  total_cents: number
  created_at: string
  paid_at: string | null
  paid_method: string | null
  note: string | null
  by_referee: { referee_id: string; referee: string; bank_details: string | null; games: number; amount_cents: number }[] | null
}
type Payments = { fees: Partial<Record<Role, number>>; unpaid: Unpaid[]; runs: Run[] }

function day(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: SYDNEY })
}
function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: SYDNEY })
}

/**
 * L-07, the organiser's side: match fees per role, what is owed to
 * referees who turned up and is not yet in a run, build a run for a
 * period, mark it paid (bank transfer today; Stripe through the route when
 * the league's and the referees' accounts exist), and the CSV.
 */
export function RefereePayments({ competitionId }: { competitionId: string }) {
  const [data, setData] = useState<Payments | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [fees, setFees] = useState<Record<Role, string>>({ referee: '', assistant: '', fourth: '' })
  const [editingFees, setEditingFees] = useState(false)
  const [from, setFrom] = useState(() => isoDate(new Date(Date.now() - 13 * 864e5)))
  const [to, setTo] = useState(() => isoDate(new Date()))
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('referee_payments', { p_competition: competitionId })
    if (error) return setError(error.message)
    const p = data as unknown as Payments | null
    if (!p) return
    setData(p)
    setFees({
      referee: p.fees.referee != null ? String(p.fees.referee / 100) : '',
      assistant: p.fees.assistant != null ? String(p.fees.assistant / 100) : '',
      fourth: p.fees.fourth != null ? String(p.fees.fourth / 100) : '',
    })
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function saveFees() {
    setBusy('fees')
    setError(null)
    const client = createClient()
    for (const [role] of ROLES) {
      const v = fees[role].trim()
      if (v === '') continue
      // Dollars typed, cents stored: 49.9 * 100 is 4989.999999999999.
      const { error } = await client.rpc('set_referee_fee', { p_competition: competitionId, p_role: role, p_fee_cents: Math.round(Number(v) * 100) })
      if (error) {
        setBusy(null)
        return setError(error.message)
      }
    }
    setBusy(null)
    setEditingFees(false)
    await load()
  }

  async function build() {
    setBusy('build')
    setError(null)
    const { data, error } = await createClient().rpc('build_referee_payment_run', { p_competition: competitionId, p_from: from, p_to: to })
    setBusy(null)
    if (error) return setError(error.message)
    if (!data) return setError('Nobody checked in to a game in that period who is not already in a run.')
    setOpen(data as string)
    await load()
  }

  async function markPaid(run: Run, method: 'bank' | 'cash') {
    setBusy(run.id)
    setError(null)
    const { error } = await createClient().rpc('mark_referee_run_paid', { p_run: run.id, p_method: method })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function payWithStripe(run: Run) {
    setBusy(run.id)
    setError(null)
    const res = await fetch('/api/payments/referees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: run.id }) })
    const body = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return setError(body.error ?? (body.failed ?? []).join('; ') ?? 'Stripe refused')
    await load()
  }

  async function voidRun(run: Run) {
    setBusy(run.id)
    setError(null)
    const { error } = await createClient().rpc('void_referee_run', { p_run: run.id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (!data) return error ? <p className="mb-3 text-sm" style={{ color: 'var(--no)' }}>{error}</p> : null

  const owed = data.unpaid.reduce((s, u) => s + u.fee_cents, 0)
  const noFees = ROLES.every(([r]) => data.fees[r] == null)

  return (
    <>
      <h3 className="eyebrow mt-5 px-1 pb-1.5">Paying the referees</h3>
      {error && (
        <p className="mb-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      <section className="card mb-3 p-3.5">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-sm">
            <b>Match fees</b>
            <span className="block text-ink-3">
              {noFees ? 'Not set — every game would pay $0.' : ROLES.filter(([r]) => data.fees[r] != null).map(([r, l]) => `${l} ${money(data.fees[r]!)}`).join(' · ')}
            </span>
          </span>
          {!editingFees && (
            <button onClick={() => setEditingFees(true)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
              Edit
            </button>
          )}
        </div>
        {editingFees && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {ROLES.map(([role, label]) => (
              <label key={role}>
                <span className="text-ink-2">{label}</span>
                <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-ink-3">$</span>
                  <input value={fees[role]} onChange={(e) => setFees({ ...fees, [role]: e.target.value })} inputMode="decimal" placeholder="0" className="w-full min-w-0 py-1.5 text-sm tabular-nums" />
                </span>
              </label>
            ))}
            <div className="col-span-3 flex gap-2">
              <button onClick={saveFees} disabled={busy === 'fees'} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Save fees</button>
              <button onClick={() => setEditingFees(false)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="card mb-3 p-3.5">
        <p className="text-sm">
          <b>Owed, not yet in a run:</b> {data.unpaid.length} {data.unpaid.length === 1 ? 'game' : 'games'} · {money(owed)}
        </p>
        <p className="mt-0.5 text-xs text-ink-3">A game counts once the referee checked in at the ground.</p>
        {data.unpaid.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs">
            {data.unpaid.slice(0, 8).map((u) => (
              <li key={u.appointment_id} className="flex gap-2">
                <span className="min-w-0 flex-1 truncate">{u.referee} · {u.home ?? 'TBC'} v {u.away ?? 'TBC'} · {day(u.starts_at)}</span>
                <span className="flex-none tabular-nums">{money(u.fee_cents)}</span>
              </li>
            ))}
            {data.unpaid.length > 8 && <li className="text-ink-3">…and {data.unpaid.length - 8} more</li>}
          </ul>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label>
            <span className="text-ink-2">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          </label>
          <label>
            <span className="text-ink-2">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          </label>
          <button onClick={build} disabled={busy === 'build' || !from || !to} className="col-span-2 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            Build a payment run for these dates
          </button>
        </div>
      </section>

      {data.runs.length > 0 && (
        <ul className="card mb-3 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
          {data.runs.map((run) => (
            <li key={run.id} className="px-3.5 py-3 text-sm">
              <button onClick={() => setOpen(open === run.id ? null : run.id)} className="flex w-full items-center gap-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{day(run.period_from)} – {day(run.period_to)} · {money(run.total_cents)}</span>
                  <span className="block text-xs text-ink-3">
                    {(run.by_referee ?? []).length} {(run.by_referee ?? []).length === 1 ? 'referee' : 'referees'} ·{' '}
                    {run.status === 'paid' ? `paid ${run.paid_method ? `by ${run.paid_method} ` : ''}${day(run.paid_at)}` : 'not paid yet'}
                  </span>
                </span>
                <span className="pill flex-none" style={run.status === 'paid' ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : { background: 'var(--maybe-bg, var(--surface-2))', color: 'var(--maybe)' }}>
                  {run.status === 'paid' ? 'Paid' : 'Draft'}
                </span>
              </button>
              {open === run.id && (
                <div className="mt-2">
                  <ul className="space-y-1 text-xs">
                    {(run.by_referee ?? []).map((b) => (
                      <li key={b.referee_id} className="flex gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{b.referee} · {b.games} {b.games === 1 ? 'game' : 'games'}</span>
                          <span className="block truncate text-ink-3">{b.bank_details ?? 'no bank details given'}</span>
                        </span>
                        <span className="flex-none tabular-nums">{money(b.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                  {run.status === 'draft' && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => markPaid(run, 'bank')} disabled={busy === run.id} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                        Paid by bank transfer
                      </button>
                      <button onClick={() => payWithStripe(run)} disabled={busy === run.id} className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>
                        Pay through Stripe
                      </button>
                      <button onClick={() => voidRun(run)} disabled={busy === run.id} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)', color: 'var(--no)' }}>
                        Void
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mb-2 px-1 text-sm">
        <a href={`/api/export/referee-payments?competitionId=${competitionId}`} className="underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>
          Download the referee payments CSV
        </a>
      </p>
    </>
  )
}
