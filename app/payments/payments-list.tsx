'use client'

import { useState } from 'react'

export type Owing = {
  request_id: string
  title: string
  description: string | null
  amount_cents: number
  currency: string
  due_on: string | null
  closes_at: string | null
  team_name: string | null
  player_id: string | null
  player_name: string | null
  status: string
  paid_at: string | null
  can_pay: boolean
}

/** A fill keeps the club's colour; text uses INK. See --brand-text. */
const NAVY = 'var(--brand)'
const INK = 'var(--brand-text)'

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  )

export function PaymentsList({
  owing,
  justPaid,
  cancelled,
}: {
  owing: Owing[]
  justPaid: boolean
  cancelled: boolean
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pay(row: Owing) {
    setBusy(row.request_id + (row.player_id ?? ''))
    setError(null)
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: row.request_id, playerId: row.player_id }),
    })
    const payload = await response.json()
    setBusy(null)
    if (!response.ok) return setError(payload.error ?? 'Could not start the payment.')
    window.location.href = payload.url
  }

  const outstanding = owing.filter((o) => o.status !== 'paid')
  const settled = owing.filter((o) => o.status === 'paid')

  return (
    <div className="p-5">
      {/*
        Not "Paid". Stripe confirms by webhook, and a browser arriving back
        here proves only that a browser arrived back here — the card may still
        be processing, and BECS takes days. Saying "paid" before the bank does
        is how a coach chases someone who already paid.
      */}
      {justPaid && (
        <p className="mb-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--yes-bg)', borderColor: 'var(--yes)', color: 'var(--yes)' }}>
          Thanks — your bank is confirming it now. This page updates on its own within a minute or
          two.
        </p>
      )}
      {cancelled && (
        <p className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] p-3 text-sm text-ink-2">
          Payment cancelled. Nothing was charged.
        </p>
      )}
      {error && (
        <p className="mb-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--no-bg)', borderColor: 'var(--no)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {owing.length === 0 && (
        <p className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Nothing to pay.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {outstanding.map((row) => {
          const key = row.request_id + (row.player_id ?? '')
          const overdue = row.due_on && new Date(row.due_on) < new Date()
          return (
            <li key={key} className="rounded-xl border border-[var(--line)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{row.title}</div>
                  {row.player_name && (
                    <div className="text-sm text-ink-2">For {row.player_name}</div>
                  )}
                  {row.description && (
                    <p className="mt-1 text-sm text-ink-2">{row.description}</p>
                  )}
                </div>
                <div className="flex-none text-right font-semibold tabular-nums" style={{ color: INK }}>
                  {money(row.amount_cents, row.currency)}
                </div>
              </div>

              {row.due_on && (
                <div className={`mt-2 text-xs ${overdue ? 'font-semibold ' : 'text-ink-2'}`}>
                  {overdue ? 'Was due ' : 'Due '}
                  {new Date(row.due_on).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'long',
                  })}
                </div>
              )}

              {row.can_pay ? (
                <button
                  onClick={() => pay(row)}
                  disabled={busy === key}
                  className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: NAVY }}
                >
                  {busy === key ? 'Opening…' : `Pay ${money(row.amount_cents, row.currency)}`}
                </button>
              ) : (
                // A dead Pay button is worse than none. If the academy has
                // not finished onboarding, say that rather than sending
                // someone into a checkout that cannot take their money.
                <p className="mt-3 rounded-lg bg-[var(--surface-2)] p-2.5 text-center text-xs text-ink-2">
                  Your club is still setting up payments. Nothing to do yet.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {settled.length > 0 && (
        <section className="mt-7">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Paid</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {settled.map((row) => (
              <li
                key={row.request_id + (row.player_id ?? '')}
                className="flex justify-between gap-3 border-b border-[var(--line-2)] py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {row.title}
                  {row.player_name ? ` · ${row.player_name}` : ''}
                </span>
                <span className="flex-none tabular-nums text-ink-2">
                  {money(row.amount_cents, row.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
