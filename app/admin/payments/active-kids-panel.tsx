'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WhenOn } from '@/components/when-on'

type Row = {
  voucher_id: string
  voucher_number: string
  child_name: string
  child_dob: string | null
  family: string | null
  fee_title: string | null
  off_cents: number | null
  entered_at: string
  redeemed_at: string | null
  redeemed_by: string | null
  /** On a registration the club has not decided: not to be redeemed yet. */
  waiting: boolean
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
const born = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * 0264: the Treasurer's list of Active & Creative Kids vouchers to redeem in
 * the Service NSW provider portal — the number, the child as on the voucher,
 * the family and the fee — with a tick once it is done. Squadroom never
 * contacts Service NSW; this is the list to work through. Shown to the
 * club's staff and its Treasurer (the database decides), only with the
 * feature on, and only once the club has said it is a provider or holds a
 * voucher.
 */
export function ActiveKidsPanel({ academyId }: { academyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [provider, setProvider] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data, error }, { data: club }] = await Promise.all([
      supabase.rpc('active_kids_to_redeem', { p_academy: academyId }),
      supabase.from('academies').select('active_kids_provider').eq('id', academyId).maybeSingle(),
    ])
    // A permission error means this screen is not theirs: nothing to show.
    setRows(error ? [] : ((data ?? []) as unknown as Row[]))
    setProvider(Boolean((club as { active_kids_provider?: boolean } | null)?.active_kids_provider))
  }, [academyId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function mark(row: Row, redeemed: boolean) {
    setBusy(row.voucher_id)
    setError(null)
    const { error } = await createClient().rpc('mark_active_kids_redeemed', { p_voucher: row.voucher_id, p_redeemed: redeemed })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (!rows || (!provider && rows.length === 0)) return null
  const todo = rows.filter((r) => !r.redeemed_at && !r.waiting).length
  return (
    <WhenOn feature="active_kids" orgId={academyId}>
      <section className="mt-5 rounded-xl border border-[var(--line)] p-4" data-active-kids-panel={todo}>
        <h2 className="font-semibold">Vouchers to redeem in Service NSW{todo ? <span className="pill ml-2">{todo}</span> : null}</h2>
        <p className="mt-0.5 text-xs text-ink-3">
          Active &amp; Creative Kids vouchers families have put on their fees. Redeem each one in the Service NSW provider
          portal, then tick it here. Squadroom never contacts Service NSW.
        </p>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
            {rows.map((r) => (
              <li key={r.voucher_id} className="flex items-start gap-3 py-2.5" data-ak-row={r.voucher_number}>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-base tracking-wide" data-ak-number>{r.voucher_number}</span>
                  <span className="block">
                    {r.child_name}
                    {r.child_dob ? <span className="text-ink-3"> · born {born(r.child_dob)}</span> : null}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {r.family ? `${r.family} · ` : ''}
                    {r.fee_title ?? 'a fee'}
                    {r.off_cents != null ? ` · $${(r.off_cents / 100).toFixed(2)} off` : ''}
                    {` · ${dayOf(r.entered_at)}`}
                  </span>
                  {r.waiting && (
                    <span className="mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                      Waiting on the registration
                    </span>
                  )}
                  {r.redeemed_at && (
                    <span className="mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>
                      Redeemed {dayOf(r.redeemed_at)}{r.redeemed_by ? ` by ${r.redeemed_by}` : ''}
                    </span>
                  )}
                </span>
                <label className="flex flex-none items-center gap-1.5 pt-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(r.redeemed_at)}
                    disabled={busy === r.voucher_id || r.waiting}
                    onChange={(e) => mark(r, e.target.checked)}
                    aria-label={`Redeemed ${r.voucher_number}`}
                    data-ak-redeemed
                  />
                  Redeemed
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </section>
    </WhenOn>
  )
}
