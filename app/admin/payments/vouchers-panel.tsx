'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Voucher = {
  id: string
  code: string
  label: string
  kind: string
  amount_cents: number | null
  percent_bps: number | null
  max_uses: number | null
  used_count: number
  expires_on: string | null
  active: boolean
}

const KINDS: [string, string][] = [
  ['government', 'Government (Active Kids)'], ['club', 'Club'], ['coach', 'Coach'],
  ['volunteer', 'Volunteer'], ['scholarship', 'Scholarship'], ['sibling', 'Sibling'],
]

/**
 * B-07 / B-12: the club's vouchers. A code with a value or a percentage, how
 * many times it may be used, when it expires. A family types the code on a
 * fee; the redemption is recorded against that fee for the books.
 */
export function VouchersPanel({ academyId }: { academyId: string }) {
  const [rows, setRows] = useState<Voucher[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ code: '', label: '', kind: 'club', mode: 'amount' as 'amount' | 'percent', value: '', max_uses: '', expires_on: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().from('vouchers').select('id, code, label, kind, amount_cents, percent_bps, max_uses, used_count, expires_on, active').eq('academy_id', academyId).order('created_at', { ascending: false })
    setRows((data as Voucher[] | null) ?? [])
  }, [academyId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    const value = Number(draft.value)
    const { error } = await createClient().from('vouchers').insert({
      academy_id: academyId,
      code: draft.code.trim().toUpperCase(),
      label: draft.label.trim(),
      kind: draft.kind,
      amount_cents: draft.mode === 'amount' ? Math.round(value * 100) : null,
      percent_bps: draft.mode === 'percent' ? Math.round(value * 100) : null,
      max_uses: draft.max_uses ? Number(draft.max_uses) : null,
      expires_on: draft.expires_on || null,
    })
    setBusy(false)
    if (error) return setError(error.code === '23505' ? 'That code already exists.' : error.message)
    setAdding(false)
    setDraft({ code: '', label: '', kind: 'club', mode: 'amount', value: '', max_uses: '', expires_on: '' })
    await load()
  }

  async function toggle(v: Voucher) {
    setBusy(true)
    const { error } = await createClient().from('vouchers').update({ active: !v.active }).eq('id', v.id)
    setBusy(false)
    if (error) return setError(error.message)
    await load()
  }

  if (!rows) return null
  return (
    <section className="mt-5 rounded-xl border border-[var(--line)] p-4" data-vouchers>
      <div className="flex items-center justify-between gap-2">
        <span>
          <h2 className="font-semibold">Vouchers</h2>
          <p className="text-xs text-ink-3">A code a family types on a fee: Active Kids, or your own. Recorded per fee for the books.</p>
        </span>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex-none rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>Add</button>
        )}
      </div>
      {adding && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <label>
            <span className="text-ink-2">Code</span>
            <input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="ACTIVEKIDS" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm uppercase" style={{ borderColor: 'var(--line)' }} />
          </label>
          <label>
            <span className="text-ink-2">Kind</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }}>
              {KINDS.map(([k, l]) => (<option key={k} value={k}>{l}</option>))}
            </select>
          </label>
          <label className="col-span-2">
            <span className="text-ink-2">What it is called</span>
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Active Kids voucher 2027" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          </label>
          <label>
            <span className="text-ink-2">Worth</span>
            <span className="mt-0.5 flex gap-1">
              <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as 'amount' | 'percent' })} className="rounded-lg border px-1 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Dollars or percent">
                <option value="amount">$</option>
                <option value="percent">%</option>
              </select>
              <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="decimal" placeholder={draft.mode === 'amount' ? '100' : '10'} className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} aria-label="Value" />
            </span>
          </label>
          <label>
            <span className="text-ink-2">Uses (blank: any)</span>
            <input value={draft.max_uses} onChange={(e) => setDraft({ ...draft, max_uses: e.target.value })} inputMode="numeric" className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm tabular-nums" style={{ borderColor: 'var(--line)' }} />
          </label>
          <label className="col-span-2">
            <span className="text-ink-2">Expires (blank: never)</span>
            <input type="date" value={draft.expires_on} onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          </label>
          <div className="col-span-2 flex gap-2">
            <button onClick={add} disabled={busy || !draft.code.trim() || !draft.label.trim() || !Number(draft.value)} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>{busy ? '…' : 'Add the voucher'}</button>
            <button onClick={() => setAdding(false)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="mt-3 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {rows.map((v) => (
            <li key={v.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium"><span className="font-mono">{v.code}</span> · {v.label}</span>
                <span className="block text-xs text-ink-3">
                  {v.amount_cents != null ? `$${(v.amount_cents / 100).toFixed(2)} off` : `${(v.percent_bps ?? 0) / 100}% off`}
                  {' · '}{v.used_count}{v.max_uses ? ` of ${v.max_uses}` : ''} used
                  {v.expires_on ? ` · until ${new Date(v.expires_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}
                  {!v.active ? ' · off' : ''}
                </span>
              </span>
              <button onClick={() => toggle(v)} disabled={busy} className="flex-none rounded border px-2 py-0.5 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>{v.active ? 'Turn off' : 'Turn on'}</button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
