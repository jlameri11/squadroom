'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Row = {
  player_name: string
  guardian_name: string | null
  outstanding_cents: number
  days_overdue: number
}

/**
 * What the club is owed, on the home screen.
 *
 * The question an owner opens the app to answer, and it was two taps into
 * Admin behind a collapsed panel. The top three overdue and a total is
 * enough to decide whether tonight is a ringing-around night; the detail
 * stays on the payments screen.
 *
 * Staff only, and enforced in the database rather than here —
 * `outstanding_fees` raises for anybody who is not an owner or admin, so a
 * parent who somehow had this section saved gets nothing rather than a list
 * of which families are behind.
 */
export function HomeOwing() {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('outstanding_fees', {
        // The generated signature is non-nullable for a `default null`
        // parameter, so "no preference" needs the cast.
        p_academy: (getOrg() ?? null) as unknown as string,
      })
      if (!live) return
      setRows(error ? [] : ((data ?? []) as Row[]))
    })()
    return () => {
      live = false
    }
  }, [])

  if (!rows || rows.length === 0) return null

  const total = rows.reduce((n, r) => n + r.outstanding_cents, 0)
  const overdue = rows.filter((r) => r.days_overdue > 0)

  return (
    <section className="px-3.5 pb-5 pt-4">
      <div className="sect">
        <span className="eyebrow">Owed to the club</span>
        <Link href="/admin/payments" className="text-xs text-ink-3 underline underline-offset-2">
          All {rows.length}
        </Link>
      </div>

      <Link href="/admin/payments" className="card block p-3.5">
        <p className="display text-[26px] leading-none" style={{ color: 'var(--brand-text)' }}>
          {money(total)}
        </p>
        <p className="mt-0.5 text-sm text-ink-3">
          across {rows.length} {rows.length === 1 ? 'child' : 'children'}
          {overdue.length > 0 && (
            <span style={{ color: 'var(--no)' }}> · {overdue.length} overdue</span>
          )}
        </p>

        {/* The three most overdue, because the only reason to look is to
            decide who to ring. */}
        {overdue.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5">
            {overdue.slice(0, 3).map((r, i) => (
              <li key={i} className="truncate text-xs text-ink-3">
                {r.player_name} — {money(r.outstanding_cents)}, {r.days_overdue}{' '}
                {r.days_overdue === 1 ? 'day' : 'days'} late
              </li>
            ))}
          </ul>
        )}
      </Link>
    </section>
  )
}

/** Integer cents, never a float. 49.9 * 100 is 4989.999999999999. */
function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
