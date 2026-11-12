'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { WithdrawButton } from '@/app/programs/withdraw-button'

type Request = {
  id: string
  club: string
  slug: string
  program: string
  child: string
  child_dob: string | null
  status: string
  created_at: string
  decided_at: string | null
  decision_note: string | null
  paid_cents: number
  refunded: boolean
}
type Registration = {
  id: string
  club: string
  academy_id: string
  program: string
  program_id: string
  kind: string
  season: string | null
  child: string
  player_id: string
  status: string
  waitlist_position: number | null
  created_at: string
  decided_at: string | null
  decision_note: string | null
  withdraw_until: string | null
  refund_bps_after: number | null
}
type Person = { id: string; full_name: string; dob: string | null; self: boolean; club: string; academy_id: string; squad: string | null }
type Payment = {
  id: string
  club: string
  title: string
  child: string | null
  amount_cents: number
  currency: string
  status: string
  paid_at: string | null
  refunded_at: string | null
  instalment_seq: number | null
}
type Mine = { requests: Request[]; registrations: Registration[]; people: Person[]; payments: Payment[] }

/** The brief's five words, and one for a request the family let lapse. */
const CHIP: Record<string, { label: string; bg: string; ink: string }> = {
  pending: { label: 'Submitted', bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
  approved: { label: 'Approved', bg: 'var(--yes-bg)', ink: 'var(--yes)' },
  waitlisted: { label: 'Waitlisted', bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
  rejected: { label: 'Rejected', bg: 'var(--no-bg)', ink: 'var(--no)' },
  declined: { label: 'Rejected', bg: 'var(--no-bg)', ink: 'var(--no)' },
  withdrawn: { label: 'Withdrawn', bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
  expired: { label: 'Lapsed', bg: 'var(--surface-2)', ink: 'var(--ink-2)' },
}

function Chip({ status, extra }: { status: string; extra?: string }) {
  const c = CHIP[status] ?? { label: status, bg: 'var(--surface-2)', ink: 'var(--ink-2)' }
  return (
    <span className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: c.bg, color: c.ink }} data-status={status}>
      {c.label}
      {extra}
    </span>
  )
}

/** A date that is not a game time: the reader's own day. */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
const born = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/**
 * A family's own view of everything they have put in: the registrations
 * (from the signed-in sign-up and from the public form — the latter theirs
 * by their mobile or email until the club approves and links the account),
 * the people they can sign up again or edit, and what they have paid, each
 * with a receipt. Withdrawing is the same button as on Sign up (0145).
 */
export function RegistrationsScreen() {
  const [mine, setMine] = useState<Mine | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('my_registrations')
    if (error) return setError(error.message)
    setMine((data as unknown as Mine) ?? { requests: [], registrations: [], people: [], payments: [] })
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  if (error) return <p className="m-4 rounded-lg p-3 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>
  if (!mine) return <ScreenSkeleton />

  // One list, newest first: a request waiting on the club beside a
  // registration the club has decided.
  const rows = [
    ...mine.registrations.map((r) => ({ kind: 'registration' as const, at: r.created_at, r })),
    ...mine.requests.map((q) => ({ kind: 'request' as const, at: q.created_at, q })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="flex flex-col gap-6 p-4">
      <section data-my-registrations={rows.length}>
        <span className="eyebrow">Registrations</span>
        {rows.length === 0 ? (
          <p className="card mt-1.5 p-5 text-center text-sm text-ink-2">
            No registrations yet.{' '}
            <Link href="/programs" className="underline underline-offset-4" style={{ color: 'var(--brand-text)' }}>
              Sign up to something
            </Link>
          </p>
        ) : (
          <ul className="card mt-1.5 overflow-hidden">
            {rows.map((row) =>
              row.kind === 'registration' ? (
                <li key={row.r.id} className="border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }} data-registration={row.r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{row.r.child}</span>
                      <span className="block text-sm text-ink-2">
                        {row.r.program}
                        {row.r.season ? ` · ${row.r.season}` : ''} · {row.r.club}
                      </span>
                    </span>
                    <Chip status={row.r.status} extra={row.r.status === 'waitlisted' && row.r.waitlist_position ? ` · #${row.r.waitlist_position}` : undefined} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    Sent {dayOf(row.r.created_at)}
                    {row.r.decided_at ? ` · decided ${dayOf(row.r.decided_at)}` : ''}
                    {row.r.decision_note ? ` · “${row.r.decision_note}”` : ''}
                  </p>
                  {['pending', 'approved', 'waitlisted'].includes(row.r.status) && (
                    <WithdrawButton
                      registrationId={row.r.id}
                      childName={row.r.child}
                      withdrawUntil={row.r.withdraw_until}
                      refundBpsAfter={row.r.refund_bps_after ?? 0}
                      onDone={load}
                    />
                  )}
                </li>
              ) : (
                <li key={row.q.id} className="border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }} data-request={row.q.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{row.q.child}</span>
                      <span className="block text-sm text-ink-2">
                        {row.q.program} · {row.q.club}
                      </span>
                    </span>
                    <Chip status={row.q.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-3">
                    Sent {dayOf(row.q.created_at)}
                    {row.q.decided_at ? ` · decided ${dayOf(row.q.decided_at)}` : ''}
                    {row.q.decision_note ? ` · “${row.q.decision_note}”` : ''}
                    {row.q.refunded ? ' · refunded in full' : row.q.paid_cents > 0 ? ` · paid ${money(row.q.paid_cents, 'aud')}, refunded in full if the club cannot take the place` : ''}
                  </p>
                  {row.q.status === 'pending' && (
                    <a href={`/${row.q.slug}/register`} className="tap mt-1 inline-block text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                      Open your registration (on the phone it was sent from) ›
                    </a>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <section data-my-people={mine.people.length}>
        <span className="eyebrow">People</span>
        {mine.people.length === 0 ? (
          <p className="card mt-1.5 p-5 text-center text-sm text-ink-2">Nobody on a roster yet. A child appears here once the club accepts a registration.</p>
        ) : (
          <ul className="card mt-1.5 overflow-hidden">
            {mine.people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }} data-person={p.id}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {p.full_name}
                    {p.self ? <span className="text-ink-3"> (you)</span> : null}
                  </span>
                  <span className="block truncate text-sm text-ink-2">
                    {p.dob ? `born ${born(p.dob)} · ` : ''}
                    {p.club}
                    {p.squad ? ` · ${p.squad}` : ''}
                  </span>
                </span>
                <span className="flex flex-none gap-3 text-xs">
                  <Link href={p.self ? '/settings' : '/settings/family'} className="tap underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                    Edit
                  </Link>
                  <Link href="/programs" className="tap underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
                    Sign up
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-my-payments={mine.payments.length}>
        <span className="eyebrow">Payments &amp; receipts</span>
        {mine.payments.length === 0 ? (
          <p className="card mt-1.5 p-5 text-center text-sm text-ink-2">No payments yet.</p>
        ) : (
          <ul className="card mt-1.5 overflow-hidden">
            {mine.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line-2)' }} data-payment={p.id}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{p.title}</span>
                  <span className="block truncate text-sm text-ink-2">
                    {p.child ? `${p.child} · ` : ''}
                    {p.club}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {p.status === 'refunded'
                      ? `Refunded${p.refunded_at ? ` ${dayOf(p.refunded_at)}` : ''}`
                      : p.status === 'processing'
                        ? 'Clearing from your bank'
                        : `Paid${p.paid_at ? ` ${dayOf(p.paid_at)}` : ''}`}
                  </span>
                </span>
                <span className="flex flex-none flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{money(p.amount_cents, p.currency)}</span>
                  <Link href={`/receipts/${p.id}`} className="tap text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }} data-receipt={p.id}>
                    Receipt ›
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-3">
          <Link href="/payments" className="underline underline-offset-2">
            What is still to pay ›
          </Link>
        </p>
      </section>
    </div>
  )
}
