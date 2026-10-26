'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  request_id: string
  title: string
  player_id: string
  player_name: string
  guardian_name: string | null
  guardian_phone: string | null
  net_cents: number
  paid_cents: number
  outstanding_cents: number
  next_due: string
  days_overdue: number
}

/**
 * Who owes what.
 *
 * The question an academy owner asks more than any other, and the one that
 * currently takes an evening with a spreadsheet. Most overdue first, because
 * the only reason to open this is to decide who to ring today.
 *
 * Each row carries the number to ring. A list of debts with no way to act on
 * it is a list that gets looked at once — the whole point is that the next
 * step is one tap away.
 *
 * Sibling discounts are already applied, through the same function that
 * prices a parent's checkout. If this screen and the invoice disagreed, an
 * owner would chase a family for money they do not owe.
 */
export function Outstanding({ academyId }: { academyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!open || rows) return
    ;(async () => {
      const { data, error } = await createClient().rpc('outstanding_fees', {
        p_academy: academyId,
      })
      if (error) return setError(error.message)
      setRows((data ?? []) as Row[])
    })()
  }, [open, rows, academyId])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-6 w-full rounded-xl border px-4 py-3 text-left text-sm font-semibold"
        style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
      >
        Who owes money
      </button>
    )
  }

  const total = (rows ?? []).reduce((n, r) => n + r.outstanding_cents, 0)
  const overdue = (rows ?? []).filter((r) => r.days_overdue > 0)
  const shown = showAll ? (rows ?? []) : (rows ?? []).slice(0, 25)

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Who owes money
        </h2>
        {rows !== null && (
          <span className="text-xs text-ink-3">
            {money(total)} across {rows.length}
          </span>
        )}
      </div>

      {error && (
        <p
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
        >
          {error}
        </p>
      )}

      {rows === null ? (
        <p className="rounded-xl border border-[var(--line)] p-5 text-center text-sm text-ink-3">
          Adding it up…
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--line)] p-5 text-center text-sm text-ink-2">
          Nothing outstanding. Everyone has paid.
        </p>
      ) : (
        <>
          {overdue.length > 0 && (
            <p
              className="mb-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
            >
              <b>{overdue.length} overdue</b> · {money(
                overdue.reduce((n, r) => n + r.outstanding_cents, 0)
              )}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--line)]">
            {shown.map((r) => (
              <div
                key={`${r.request_id}-${r.player_id}`}
                className="flex items-center gap-3 border-t border-[var(--line-2)] p-3 first:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.player_name}</span>
                  <span className="block truncate text-sm text-ink-3">
                    {r.title}
                    {r.paid_cents > 0 && ` · ${money(r.paid_cents)} paid of ${money(r.net_cents)}`}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {r.guardian_name ?? 'No guardian linked'}
                    {r.days_overdue > 0 && (
                      <span style={{ color: 'var(--no)' }}>
                        {' '}
                        · {r.days_overdue} {r.days_overdue === 1 ? 'day' : 'days'} overdue
                      </span>
                    )}
                  </span>
                </span>

                <span className="flex flex-none items-center gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {money(r.outstanding_cents)}
                  </span>
                  {/* The next step, one tap away. A list of debts with no way
                      to act on it gets looked at once. */}
                  {r.guardian_phone && (
                    <a
                      href={`tel:${r.guardian_phone}`}
                      className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)]"
                      aria-label={`Call ${r.guardian_name}`}
                    >
                      📞
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>

          {!showAll && rows.length > shown.length && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 text-sm underline underline-offset-4 text-ink-2"
            >
              Show the other {rows.length - shown.length}
            </button>
          )}

          <p className="mt-2 text-xs text-ink-3">
            Sibling discounts are already taken off, and part-paid fees show what is left.
          </p>
        </>
      )}
    </section>
  )
}

/** Integer cents, never a float. 49.9 * 100 is 4989.999999999999. */
function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
