'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Receipt = {
  id: string
  club: { name: string; logo_url: string | null; slug: string } | null
  payer: string | null
  child: string | null
  title: string | null
  description: string | null
  program: string | null
  amount_cents: number
  currency: string
  status: string
  paid_at: string | null
  refunded_at: string | null
  instalment_seq: number | null
  instalments: number | null
  stripe_payment_intent: string | null
  voucher_cents: number | null
  voucher_label: string | null
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * What was paid, for whom, to whom and when, with Stripe's id for the
 * payment. The money went to the club's own account; Squadroom held none
 * of it and added nothing to it, and the receipt says so.
 */
export function ReceiptScreen({ paymentId }: { paymentId: string }) {
  const [receipt, setReceipt] = useState<Receipt | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await createClient().rpc('payment_receipt', { p_payment: paymentId })
      if (error) {
        setReceipt(null)
        return setError(error.code === '42501' ? 'This receipt is not yours to see.' : error.message)
      }
      setReceipt(data as unknown as Receipt)
    })()
  }, [paymentId])

  if (receipt === undefined) return <ScreenSkeleton />
  if (!receipt) return <p className="card m-4 p-6 text-center text-sm text-ink-2">{error ?? 'Not found.'}</p>

  const status =
    receipt.status === 'refunded'
      ? `Refunded${receipt.refunded_at ? ` on ${when(receipt.refunded_at)}` : ''}`
      : receipt.status === 'processing'
        ? 'Clearing from your bank — two or three business days'
        : receipt.status === 'paid'
          ? `Paid${receipt.paid_at ? ` on ${when(receipt.paid_at)}` : ''}`
          : receipt.status

  return (
    <div className="p-4">
      <article className="card overflow-hidden" data-receipt-card>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
          {receipt.club?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={receipt.club.logo_url} alt="" className="h-9 w-9 flex-none rounded-lg bg-white/10 object-contain p-0.5" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{receipt.club?.name}</span>
            <span className="block text-xs" style={{ color: '#ffffffb3' }}>Receipt</span>
          </span>
        </div>
        <div className="p-4">
          <p className="display text-3xl leading-none tabular-nums" data-receipt-amount>{money(receipt.amount_cents, receipt.currency)}</p>
          <p className="mt-1 text-sm" style={{ color: receipt.status === 'refunded' ? 'var(--no)' : 'var(--yes)' }} data-receipt-status={receipt.status}>
            {status}
          </p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">For</dt>
            <dd>
              {receipt.title}
              {receipt.program && receipt.program !== receipt.title ? ` · ${receipt.program}` : ''}
              {receipt.instalments && receipt.instalments > 1 ? ` · instalment ${receipt.instalment_seq ?? 1} of ${receipt.instalments}` : ''}
            </dd>
            {receipt.child && (
              <>
                <dt className="text-ink-3">Player</dt>
                <dd data-receipt-child>{receipt.child}</dd>
              </>
            )}
            {receipt.payer && (
              <>
                <dt className="text-ink-3">Paid by</dt>
                <dd>{receipt.payer}</dd>
              </>
            )}
            <dt className="text-ink-3">Paid to</dt>
            <dd>{receipt.club?.name}</dd>
            {receipt.voucher_cents ? (
              <>
                <dt className="text-ink-3">Voucher</dt>
                <dd>
                  {receipt.voucher_label ?? 'Voucher'} — {money(receipt.voucher_cents, receipt.currency)} off the fee
                </dd>
              </>
            ) : null}
            {receipt.stripe_payment_intent && (
              <>
                <dt className="text-ink-3">Stripe id</dt>
                <dd className="break-all font-mono text-xs" data-receipt-stripe>{receipt.stripe_payment_intent}</dd>
              </>
            )}
            <dt className="text-ink-3">Receipt no.</dt>
            <dd className="break-all font-mono text-xs">{receipt.id}</dd>
          </dl>
          {receipt.description && <p className="mt-3 text-xs text-ink-3">{receipt.description}</p>}
        </div>
        <p className="border-t px-4 py-3 text-xs text-ink-3" style={{ borderColor: 'var(--line-2)' }}>
          Paid to {receipt.club?.name} through Stripe, into the club&apos;s own account. Squadroom holds none of it and adds nothing to it.
        </p>
      </article>
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-4 w-full rounded-xl border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: 'var(--line)' }}
        data-receipt-print
      >
        Save or print
      </button>
    </div>
  )
}
