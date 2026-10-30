import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient, getUserId } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Issue a refund that withdraw_registration (0145) worked out and wrote down.
 *
 * The amount comes from the `refunds` row, never the request body, and the
 * row was computed in the database from the payment actually made and the
 * program's policy at the moment of withdrawing. This route only tells
 * Stripe — on the club's CONNECTED account, because a direct charge is
 * refunded where it was made — and records the answer.
 *
 * Staff only: the caller's session must be able to read the refund (RLS:
 * guardian or staff) AND the update is gated on staff here, because a
 * guardian can see their own refund and must not be able to issue it.
 *
 * Without a Stripe key the row stays 'requested' and the treasurer is told
 * plainly. The webhook's charge.refunded marks the payment when Stripe
 * confirms.
 */
export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const { refundId } = (body ?? {}) as { refundId?: string }
  if (!refundId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: refund } = await supabase
    .from('refunds')
    .select('id, academy_id, status, amount_cents, payment_id')
    .eq('id', refundId)
    .maybeSingle()
  if (!refund) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: me } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', refund.academy_id)
    .eq('profile_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (!me || !['owner', 'admin'].includes(me.role)) {
    return NextResponse.json({ error: 'Only the club can issue a refund' }, { status: 403 })
  }
  if (refund.status !== 'requested') {
    return NextResponse.json({ error: `Already ${refund.status}` }, { status: 409 })
  }

  const admin = createAdminClient()
  const [{ data: payment }, { data: billing }] = await Promise.all([
    admin.from('payments').select('stripe_payment_intent, currency').eq('id', refund.payment_id).single(),
    admin.from('academy_billing').select('stripe_account_id').eq('academy_id', refund.academy_id).maybeSingle(),
  ])
  if (!payment?.stripe_payment_intent) {
    return NextResponse.json({ error: 'This payment has no Stripe charge to refund.' }, { status: 409 })
  }

  const key = process.env.STRIPE_SECRET_KEY
  if (!key || !billing?.stripe_account_id) {
    return NextResponse.json(
      { error: "Stripe isn't set up for this club yet. The refund is recorded and can be issued once it is." },
      { status: 503 }
    )
  }

  const stripe = new Stripe(key)
  try {
    const issued = await stripe.refunds.create(
      { payment_intent: payment.stripe_payment_intent, amount: refund.amount_cents },
      { stripeAccount: billing.stripe_account_id }
    )
    await admin
      .from('refunds')
      .update({ status: 'issued', issued_at: new Date().toISOString(), issued_by: userId, stripe_refund_id: issued.id })
      .eq('id', refund.id)
    return NextResponse.json({ ok: true, stripe_refund_id: issued.id })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Stripe refused the refund'
    await admin.from('refunds').update({ status: 'failed', note: message.slice(0, 500) }).eq('id', refund.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
