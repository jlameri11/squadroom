'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type BillingStatus = {
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
} | null

export type RequestRow = {
  id: string
  title: string
  amount_cents: number
  currency: string
  due_on: string | null
  per_player: boolean
  team_id: string | null
  teams: { name: string } | null
}

type RegisterRow = {
  player_id: string
  player_name: string
  guardian: string | null
  guardian_phone: string | null
  status: string
  paid_at: string | null
  amount_cents: number
}

const NAVY = 'var(--brand)'
const money = (cents: number, currency = 'aud') =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100
  )

export function PaymentsAdmin({
  academyId,
  academyName,
  billing,
  requests,
  teams,
}: {
  academyId: string
  academyName: string
  billing: BillingStatus
  requests: RequestRow[]
  teams: { id: string; name: string }[]
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setBusy(true)
    setError(null)
    const response = await fetch('/api/payments/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ academyId }),
    })
    const payload = await response.json()
    setBusy(false)
    if (!response.ok) return setError(payload.error ?? 'Could not start setup.')
    window.location.href = payload.url
  }

  const ready = billing?.charges_enabled === true
  const started = Boolean(billing?.stripe_account_id)

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: NAVY }}>
        Payments
      </h1>
      <p className="mt-0.5 text-sm text-ink-2">{academyName}</p>

      <section className="mt-5 rounded-xl border border-[var(--line)] p-4">
        <h2 className="font-semibold">Where the money goes</h2>
        {/*
          Stated plainly and first. A treasurer handing over bank details
          deserves to know who ends up holding the money, and the answer here
          is genuinely "not us".
        */}
        <p className="mt-1 text-sm text-ink-2">
          Straight into {academyName}&apos;s own bank account. Squadroom never holds your money and
          never sees a card number — Stripe handles all of it.
        </p>

        {ready ? (
          <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
            Ready to take payments.
            {billing?.payouts_enabled === false &&
              ' Payouts to your bank are still being verified — you can charge now, and the money will land once that clears.'}
          </p>
        ) : started ? (
          <>
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {billing?.details_submitted
                ? 'Stripe is checking your details. This usually takes a few minutes, occasionally a day or two.'
                : 'Setup was started but not finished.'}
            </p>
            <button
              onClick={connect}
              disabled={busy}
              className="mt-3 w-full rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-medium"
            >
              {busy ? 'Opening…' : 'Finish setup with Stripe'}
            </button>
          </>
        ) : (
          <button
            onClick={connect}
            disabled={busy}
            className="mt-3 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: NAVY }}
          >
            {busy ? 'Opening…' : 'Set up payments'}
          </button>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <NewRequest academyId={academyId} teams={teams} disabled={!ready} />

      <section className="mt-6">
        <h2 className="font-semibold" style={{ color: NAVY }}>
          What you&apos;re collecting
        </h2>
        {requests.length === 0 ? (
          <p className="mt-2 rounded-xl bg-[var(--surface-2)] p-4 text-center text-sm text-ink-2">
            Nothing yet.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {requests.map((r) => (
              <RequestCard key={r.id} request={r} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function RequestCard({ request }: { request: RequestRow }) {
  const [register, setRegister] = useState<RegisterRow[] | null>(null)
  const [open, setOpen] = useState(false)

  async function toggle() {
    if (open) return setOpen(false)
    setOpen(true)
    if (register) return
    const supabase = createClient()
    const { data } = await supabase.rpc('payment_register', { p_request: request.id })
    setRegister((data ?? []) as RegisterRow[])
  }

  const paid = register?.filter((r) => r.status === 'paid') ?? []
  const unpaid = register?.filter((r) => r.status !== 'paid') ?? []

  return (
    <li className="rounded-xl border border-[var(--line)] p-3">
      <button onClick={toggle} className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="block font-medium">{request.title}</span>
          <span className="block text-sm text-ink-2">
            {[
              request.teams?.name ?? 'Whole academy',
              request.per_player ? 'per player' : 'per family',
              request.due_on
                ? `due ${new Date(request.due_on).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="flex-none font-semibold tabular-nums" style={{ color: NAVY }}>
          {money(request.amount_cents, request.currency)}
        </span>
      </button>

      {open && register && (
        <div className="mt-3 border-t border-[var(--line-2)] pt-3">
          <p className="text-sm font-medium">
            {paid.length} paid · {unpaid.length} outstanding ·{' '}
            <span style={{ color: 'var(--yes)' }}>
              {money(paid.reduce((sum, r) => sum + r.amount_cents, 0), request.currency)} collected
            </span>
          </p>
          {/*
            Unpaid first, with the parent's number beside the name. Chasing is
            the actual job, and a coach should not have to leave this screen
            to do it.
          */}
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {unpaid.map((r) => (
              <li key={r.player_id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{r.player_name}</span>
                {r.guardian_phone ? (
                  <a
                    href={`sms:${r.guardian_phone}`}
                    className="flex-none text-xs underline underline-offset-2"
                    style={{ color: NAVY }}
                  >
                    Text {r.guardian?.split(' ')[0] ?? 'parent'}
                  </a>
                ) : (
                  <span className="flex-none text-xs text-ink-3">no number</span>
                )}
              </li>
            ))}
            {paid.map((r) => (
              <li key={r.player_id} className="flex justify-between gap-2 text-ink-3">
                <span className="min-w-0 truncate line-through">{r.player_name}</span>
                <span className="flex-none text-xs">paid</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

function NewRequest({
  academyId,
  teams,
  disabled,
}: {
  academyId: string
  teams: { id: string; name: string }[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [teamId, setTeamId] = useState('')
  const [dueOn, setDueOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typed as dollars, stored as cents. Math.round rather than a cast: 49.9
  // times 100 is 4989.999999999999 in floating point, and truncating that
  // undercharges every parent by a cent.
  const cents = Math.round(Number(amount.replace(/[^\d.]/g, '')) * 100)
  const valid = title.trim().length > 0 && cents >= 100 && cents <= 500000

  async function create() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase.from('payment_requests').insert({
      academy_id: academyId,
      title: title.trim(),
      amount_cents: cents,
      team_id: teamId || null,
      due_on: dueOn || null,
      created_by: auth.user?.id ?? null,
    })
    setBusy(false)
    if (error) return setError(error.message)
    window.location.reload()
  }

  if (disabled) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-medium"
      >
        Ask for a payment
      </button>
    )
  }

  return (
    <section className="mt-4 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Ask for a payment</h2>
      <div className="mt-3 flex flex-col gap-2">
        <label className="text-sm">
          <span className="text-ink-2">What for</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Spring Gala Day entry"
            className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
          />
        </label>
        <label className="text-sm">
          <span className="text-ink-2">How much, per player</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="45.00"
            className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2 tabular-nums"
          />
        </label>
        <label className="text-sm">
          <span className="text-ink-2">Who</span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
          >
            <option value="">Everyone at the academy</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-ink-2">Due by (optional)</span>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={create}
          disabled={busy || !valid}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: NAVY }}
        >
          {busy ? 'Creating…' : valid ? `Ask for ${money(cents)}` : 'Fill this in'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
