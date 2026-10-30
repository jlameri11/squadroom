'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Refund = {
  id: string
  status: 'requested' | 'issued' | 'failed' | 'declined'
  amount_cents: number
  reason: string | null
  requested_at: string
  issued_at: string | null
  note: string | null
  player: string
  program: string | null
  paid_cents: number
  payment_intent: string | null
}

/**
 * Refunds the database has worked out and the club has to issue.
 *
 * Each one was computed by withdraw_registration (0145) from the payment
 * actually made and the program's policy at the moment of withdrawing. The
 * amount is on the row; "Issue" tells Stripe and nothing else.
 */
export function RefundsPanel({ academyId }: { academyId: string }) {
  const [refunds, setRefunds] = useState<Refund[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('refunds_to_issue', { p_academy: academyId })
    if (error) return setError(error.message)
    setRefunds((data ?? []) as unknown as Refund[])
  }, [academyId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function issue(id: string) {
    setBusy(id)
    setError(null)
    const res = await fetch('/api/payments/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refundId: id }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) setError(body.error ?? 'Could not issue the refund.')
    await load()
  }

  if (!refunds || refunds.length === 0) return null
  const waiting = refunds.filter((r) => r.status === 'requested')
  const money = (c: number) => `$${(c / 100).toFixed(2)}`

  return (
    <section className="mt-5 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Refunds {waiting.length > 0 ? `· ${waiting.length} to issue` : ''}</h2>
      <p className="mt-1 text-sm text-ink-2">
        Worked out when a family withdrew, from what they paid and the program&apos;s cut-off. Issuing sends it
        back to their card through Stripe.
      </p>
      {error && (
        <p className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
          {error}
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {refunds.map((r) => (
          <li key={r.id} className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {r.player} · {money(r.amount_cents)}
                <span className="font-normal text-ink-3"> of {money(r.paid_cents)}</span>
              </span>
              <span className="block truncate text-xs text-ink-3">
                {[r.program, r.reason ? `“${r.reason}”` : null, r.status !== 'requested' ? r.status : null, r.note]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {r.status === 'requested' && (
              <button
                onClick={() => issue(r.id)}
                disabled={busy === r.id}
                className="flex-none rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {busy === r.id ? '…' : 'Issue'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
