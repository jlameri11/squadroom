import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { stripeOrNull } from '@/lib/stripe/client'

/**
 * Issue a refund that is already written down (a `refunds` row), on the
 * club's CONNECTED account, because a direct charge is refunded where it
 * was made. The amount is the row's, never a caller's. Used by the refund
 * route (the Treasurer's tap) and, since 0262, by a declined pay-now
 * registration, which refunds in full without anyone tapping.
 */
export async function issueRefund(
  admin: SupabaseClient<Database>,
  refundId: string,
  issuedBy: string | null
): Promise<{ ok: true; stripe_refund_id: string } | { ok: false; status: number; error: string }> {
  const { data: refund } = await admin.from('refunds').select('id, academy_id, status, amount_cents, payment_id').eq('id', refundId).maybeSingle()
  if (!refund) return { ok: false, status: 404, error: 'Not found' }
  if (refund.status !== 'requested') return { ok: false, status: 409, error: `Already ${refund.status}` }

  const [{ data: payment }, { data: billing }] = await Promise.all([
    admin.from('payments').select('stripe_payment_intent, currency').eq('id', refund.payment_id).single(),
    admin.from('academy_billing').select('stripe_account_id').eq('academy_id', refund.academy_id).maybeSingle(),
  ])
  if (!payment?.stripe_payment_intent) return { ok: false, status: 409, error: 'This payment has no Stripe charge to refund.' }
  const stripe = stripeOrNull()
  if (!stripe || !billing?.stripe_account_id) {
    return { ok: false, status: 503, error: "Stripe isn't set up for this club yet. The refund is recorded and can be issued once it is." }
  }
  try {
    const issued = await stripe.refunds.create(
      { payment_intent: payment.stripe_payment_intent, amount: refund.amount_cents, metadata: { payment_id: refund.payment_id ?? '', refund_id: refund.id } },
      { stripeAccount: billing.stripe_account_id }
    )
    await admin.from('refunds').update({ status: 'issued', issued_at: new Date().toISOString(), issued_by: issuedBy, stripe_refund_id: issued.id }).eq('id', refund.id)
    return { ok: true, stripe_refund_id: issued.id }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Stripe refused the refund'
    await admin.from('refunds').update({ status: 'failed', note: message.slice(0, 500) }).eq('id', refund.id)
    return { ok: false, status: 502, error: message }
  }
}
