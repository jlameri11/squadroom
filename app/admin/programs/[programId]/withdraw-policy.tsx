'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * The program's refund policy: full until a date, a share after it.
 *
 * Written straight to the program — RLS lets staff update programs, and the
 * constraint holds the share between 0 and 100%. Shown to families on the
 * Withdraw button, and applied by withdraw_registration (0145) at the moment
 * of withdrawing, so what they were told is what they get.
 */
export function WithdrawPolicy({
  programId,
  withdrawUntil,
  refundBpsAfter,
  onSaved,
}: {
  programId: string
  withdrawUntil: string | null
  refundBpsAfter: number
  onSaved: (until: string | null, bps: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [until, setUntil] = useState(withdrawUntil ?? '')
  const [pct, setPct] = useState(String(refundBpsAfter / 100))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const bps = Math.round(Number(pct) * 100)
    const { data, error } = await createClient()
      .from('programs')
      .update({ withdraw_until: until || null, refund_bps_after: Number.isFinite(bps) ? bps : 0 })
      .eq('id', programId)
      .select('id')
      .maybeSingle()
    setBusy(false)
    if (error) return setError(error.message)
    if (!data) return setError('Could not save — are you an admin of this club?')
    onSaved(until || null, bps)
    setOpen(false)
  }

  const summary = withdrawUntil
    ? `Full refund until ${new Date(withdrawUntil + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}, then ${refundBpsAfter / 100}%`
    : 'Full refund while open'

  if (!open) {
    return (
      <div className="card mb-4 flex items-center gap-3 p-3.5">
        <span className="min-w-0 flex-1 text-sm">
          <b>Withdrawals</b>
          <span className="block truncate text-ink-3">{summary}</span>
        </span>
        <button onClick={() => setOpen(true)} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="card mb-4 p-3.5">
      <h2 className="eyebrow pb-2">Withdrawals and refunds</h2>
      <label className="block text-sm">
        <span className="text-ink-2">Full refund until</span>
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border px-3 py-2 text-base" style={{ borderColor: 'var(--line)' }} />
        <span className="mt-0.5 block text-xs text-ink-3">Leave blank for a full refund any time while the program is open.</span>
      </label>
      <label className="mt-2 block text-sm">
        <span className="text-ink-2">After that, refund</span>
        <span className="mt-0.5 flex items-center gap-1 rounded-lg border px-2" style={{ borderColor: 'var(--line)' }}>
          <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className="w-full min-w-0 py-2 tabular-nums" aria-label="Refund after the cut-off, percent" />
          <span className="flex-none whitespace-nowrap text-ink-3">% of what was paid</span>
        </span>
      </label>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={busy} className="flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => { setUntil(withdrawUntil ?? ''); setPct(String(refundBpsAfter / 100)); setOpen(false) }} className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>
          Cancel
        </button>
      </div>
    </div>
  )
}
