'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
  /** B-07 (0193): a voucher already on this fee. */
  voucher_cents?: number
  voucher_label?: string | null
  /** B-08 (0227): the day the family said they would pay by. */
  promised_by?: string | null
}

/** A date-only string, read as the reader's own day (never through UTC). */
function dayOf(ymd: string) {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA')

/** A fill keeps the club's colour; text uses INK. See --brand-text. */
const BRAND = 'var(--brand)'
const INK = 'var(--brand-text)'

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  )

export function PaymentsList({
  owing,
  justPaid,
  cancelled,
  onChanged,
}: {
  owing: Owing[]
  justPaid: boolean
  cancelled: boolean
  /** The list is read again — after a day is picked (0227). */
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  // B-07: a voucher code typed on one child's fee.
  const [codeFor, setCodeFor] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [applied, setApplied] = useState<string | null>(null)
  // B-08: "Can't pay today? Pick a day" — the family's own day, before the chase.
  const [laterFor, setLaterFor] = useState<string | null>(null)
  const [laterDate, setLaterDate] = useState('')

  const latestDay = (row: Owing) => {
    const sixty = inDays(60)
    const closes = row.closes_at ? new Date(row.closes_at).toLocaleDateString('en-CA') : null
    return closes && closes < sixty ? closes : sixty
  }
  function openLater(row: Owing) {
    const last = latestDay(row)
    const due = row.due_on && row.due_on > inDays(0) && row.due_on <= last ? row.due_on : null
    setLaterDate(row.promised_by ?? due ?? (inDays(14) <= last ? inDays(14) : last))
    setLaterFor(row.request_id + (row.player_id ?? ''))
    setError(null)
  }
  async function promise(row: Owing) {
    const key = row.request_id + (row.player_id ?? '')
    setBusy(key + ':later')
    setError(null)
    const { error } = await createClient().rpc('promise_to_pay', { p_request: row.request_id, p_player: row.player_id ?? undefined, p_by: laterDate })
    setBusy(null)
    if (error) return setError(error.message)
    setLaterFor(null)
    onChanged?.()
  }

  async function redeem(row: Owing) {
    const key = row.request_id + (row.player_id ?? '')
    setBusy(key)
    setError(null)
    const { data, error } = await createClient().rpc('redeem_voucher', { p_code: code, p_request: row.request_id, p_player: row.player_id } as never)
    setBusy(null)
    if (error) return setError(error.message)
    const r = data as unknown as { voucher: string; off_cents: number }
    setApplied(`${r.voucher}: ${money(r.off_cents, row.currency)} off.`)
    setCodeFor(null)
    setCode('')
    router.refresh()
  }

  // R-04: one checkout for every child on the same request.
  async function payAll(requestId: string, playerIds: string[]) {
    setBusy(requestId + ':all')
    setError(null)
    const response = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, playerIds }),
    })
    const payload = await response.json()
    setBusy(null)
    if (!response.ok) return setError(payload.error ?? 'Could not start the payment.')
    window.location.assign(payload.url)
  }

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

  // A bank payment that is clearing (B-08) is neither owed nor paid yet:
  // never a Pay button, and never "Paid" before the bank has said so.
  const outstanding = owing.filter((o) => o.status !== 'paid' && o.status !== 'processing')
  const clearing = owing.filter((o) => o.status === 'processing')
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

      {/* R-04: a family with two children on one fee pays once. */}
      {Object.entries(
        outstanding.reduce<Record<string, Owing[]>>((acc, r) => {
          if (r.player_id && r.can_pay) (acc[r.request_id] ??= []).push(r)
          return acc
        }, {})
      )
        .filter(([, rows]) => rows.length > 1)
        .map(([requestId, rows]) => (
          <button
            key={requestId}
            onClick={() => payAll(requestId, rows.map((r) => r.player_id as string))}
            disabled={busy !== null}
            className="mb-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50"
            style={{ background: BRAND }}
            data-pay-all={requestId}
          >
            {busy === requestId + ':all' ? 'Starting…' : `Pay ${rows[0].title} for ${rows.map((r) => (r.player_name ?? '').split(' ')[0]).join(' and ')} in one go`}
          </button>
        ))}

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
                  {row.voucher_cents ? (
                    <>
                      <span className="block text-xs font-normal text-ink-3 line-through">{money(row.amount_cents, row.currency)}</span>
                      {money(Math.max(0, row.amount_cents - row.voucher_cents), row.currency)}
                    </>
                  ) : money(row.amount_cents, row.currency)}
                </div>
              </div>
              {row.voucher_cents ? (
                <p className="mt-1 text-xs" style={{ color: 'var(--yes)' }} data-voucher-applied>
                  {row.voucher_label ?? 'Voucher'} — {money(row.voucher_cents, row.currency)} off
                </p>
              ) : codeFor === key ? (
                <div className="mt-2 flex gap-2">
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Voucher code" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm uppercase" style={{ borderColor: 'var(--line)' }} aria-label="Voucher code" />
                  <button onClick={() => redeem(row)} disabled={busy === key || !code.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: BRAND }}>Apply</button>
                  <button onClick={() => setCodeFor(null)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setCodeFor(key); setCode('') }} className="tap mt-1 text-xs underline underline-offset-2 text-ink-3" data-have-a-code>
                  Have a voucher code?
                </button>
              )}
              {applied && codeFor === null && <p className="mt-1 text-xs" style={{ color: 'var(--yes)' }}>{applied}</p>}

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
                  className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50"
                  style={{ background: BRAND }}
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

              {/* B-08 (0227): a day of their own. The club sees it instead of
                  chasing; a reminder comes the day before; nothing owed changes. */}
              {laterFor === key ? (
                <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--line)' }} data-pay-later-form>
                  <label className="block text-xs text-ink-2">
                    I&apos;ll pay by
                    <input
                      type="date"
                      value={laterDate}
                      min={inDays(1)}
                      max={latestDay(row)}
                      onChange={(e) => setLaterDate(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-base"
                      style={{ borderColor: 'var(--line)' }}
                    />
                  </label>
                  <p className="mt-1 text-[0.6875rem] text-ink-3">
                    The club sees your day instead of chasing you, and you get a reminder the day before. What is owed does not change.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => promise(row)}
                      disabled={busy === key + ':later' || !laterDate}
                      className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50"
                      style={{ background: BRAND }}
                      data-pay-later-save
                    >
                      {busy === key + ':later' ? '…' : 'Set the day'}
                    </button>
                    <button onClick={() => setLaterFor(null)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : row.promised_by ? (
                <p className="mt-2 text-xs text-ink-2" data-promised={row.promised_by}>
                  You said you&apos;d pay by {dayOf(row.promised_by)}. We&apos;ll remind you the day before.{' '}
                  <button onClick={() => openLater(row)} className="tap underline underline-offset-2">
                    Change
                  </button>
                </p>
              ) : (
                <button onClick={() => openLater(row)} className="tap mt-2 text-xs underline underline-offset-2 text-ink-3" data-pay-later>
                  Can&apos;t pay today? Pick a day
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {clearing.length > 0 && (
        <section className="mt-7" data-clearing>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Clearing</h2>
          <p className="mt-1 text-xs text-ink-3">
            Paid from your bank account. A bank payment takes two or three business days to arrive — nothing more to do.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {clearing.map((row) => (
              <li
                key={row.request_id + (row.player_id ?? '')}
                className="flex justify-between gap-3 border-b border-[var(--line-2)] py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  {row.title}
                  {row.player_name ? ` · ${row.player_name}` : ''}
                </span>
                <span className="flex-none tabular-nums text-ink-2">{money(row.amount_cents, row.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
