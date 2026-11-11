'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Timing = 'now' | 'after_approval'

/**
 * The registration brief, gap 1 (0262): when a family pays this program's
 * fee. "Pay now" charges on submit and refunds in full on a decline — a
 * season squad, where the place is as good as given. "Once accepted" asks
 * for the fee after the club says yes — a trial or a selective squad, which
 * should never take money it may have to give back.
 */
export function PayTimingToggle({ programId, value, paymentRequired, onSaved }: {
  programId: string
  value: Timing
  paymentRequired: boolean
  onSaved: (value: Timing) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(next: Timing) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().from('programs').update({ pay_timing: next }).eq('id', programId)
    setBusy(false)
    if (error) return setError(error.message)
    onSaved(next)
  }

  return (
    <section className="card mb-5 p-3.5" data-pay-timing={value}>
      <span className="block text-sm font-medium">When the fee is paid</span>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {([['now', 'Pay now, on registration'], ['after_approval', 'Once the club accepts']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => void set(k)} disabled={busy || !paymentRequired} aria-pressed={value === k} className="rounded-full border px-3 py-1.5 font-semibold disabled:opacity-50" style={value === k ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', color: 'var(--ink-2)' }} data-pay-timing-pick={k}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-3">
        {!paymentRequired
          ? 'This program has no fee.'
          : value === 'now'
            ? 'The family pays on Stripe straight after the form; if you decline, the fee goes back in full on its own.'
            : 'The family is asked for the fee once you accept — right for a trial or a selective squad.'}
      </p>
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
