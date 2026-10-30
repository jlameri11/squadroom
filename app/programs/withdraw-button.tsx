'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * A family withdrawing a child from a program.
 *
 * Says the money before the tap: a full refund until the cut-off, a share
 * after it, or none — the program's own policy, read from the row. The
 * refund is worked out and recorded by the database at the moment of
 * withdrawing; the club then issues it.
 */
export function WithdrawButton({
  registrationId,
  childName,
  withdrawUntil,
  refundBpsAfter,
  onDone,
}: {
  registrationId: string
  childName: string
  withdrawUntil: string | null
  refundBpsAfter: number
  onDone: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ policy: string; refund_cents: number } | null>(null)

  const cutoff = withdrawUntil ? new Date(withdrawUntil + 'T00:00:00') : null
  const beforeCutoff = !cutoff || new Date() <= new Date(cutoff.getTime() + 86399_000)
  const policyLine = beforeCutoff
    ? cutoff
      ? `Full refund of anything paid, until ${cutoff.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}.`
      : 'Full refund of anything paid.'
    : refundBpsAfter > 0
      ? `After the cut-off: ${refundBpsAfter / 100}% of anything paid comes back.`
      : 'After the cut-off: no refund.'

  async function withdraw() {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('withdraw_registration', {
      p_registration: registrationId,
      p_reason: reason.trim() || undefined,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setResult(data as unknown as { policy: string; refund_cents: number })
    await onDone()
  }

  if (result) {
    return (
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
        Withdrawn.{' '}
        {result.refund_cents > 0
          ? `A refund of $${(result.refund_cents / 100).toFixed(2)} is recorded for the club to issue.`
          : result.policy === 'none'
            ? 'No refund applies after the cut-off.'
            : 'Nothing had been paid, so nothing to refund.'}
      </p>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="ml-2 text-xs underline underline-offset-2 text-ink-3">
        Withdraw
      </button>
    )
  }

  return (
    <div className="mt-1.5 rounded-lg border p-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>
      <p className="text-ink-2">
        Withdraw {childName.split(' ')[0]}? {policyLine}
      </p>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why (optional, the club sees this)"
        className="mt-2 w-full rounded-lg border px-3 py-2 text-base"
        style={{ borderColor: 'var(--line)' }}
      />
      {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={withdraw} disabled={busy} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--no)' }}>
          {busy ? '…' : 'Yes, withdraw'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>
          Keep the place
        </button>
      </div>
    </div>
  )
}
