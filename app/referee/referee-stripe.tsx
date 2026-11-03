'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type Status = { connected: boolean; started: boolean; outstanding?: number }

/**
 * L-07, the Stripe half: a referee connects their own account to be paid
 * straight from the league's. Read back on demand, because an Accounts v2
 * account raises no classic webhook.
 */
export function RefereeStripe() {
  const params = useSearchParams()
  const [status, setStatus] = useState<Status | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cameBack = params.get('connect') === 'return'

  useEffect(() => {
    let live = true
    ;(async () => {
      const res = await fetch('/api/payments/referees/connect')
      const data = res.ok ? ((await res.json()) as Status) : null
      if (live) setStatus(res.status === 503 ? null : data)
    })()
    return () => {
      live = false
    }
  }, [cameBack])

  async function connect() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/payments/referees/connect', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(data.error ?? 'Could not start.')
    window.location.href = data.url
  }

  if (status === undefined || status === null) return null
  return (
    <div className="mt-2 flex items-center gap-2 text-xs" data-referee-stripe>
      <span className="min-w-0 flex-1 text-ink-2">
        {status.connected ? 'Stripe connected — a league can pay you straight to your bank.' : status.started ? `Stripe setup started${status.outstanding ? ` · ${status.outstanding} thing${status.outstanding === 1 ? '' : 's'} still needed` : ''}.` : 'Or connect Stripe and be paid straight to your bank.'}
      </span>
      {!status.connected && (
        <button onClick={connect} disabled={busy} className="flex-none rounded-lg border px-2 py-1" style={{ borderColor: 'var(--line)' }} data-referee-connect>
          {busy ? '…' : status.started ? 'Finish Stripe setup' : 'Connect Stripe'}
        </button>
      )}
      {error && <span style={{ color: 'var(--no)' }}>{error}</span>}
    </div>
  )
}
