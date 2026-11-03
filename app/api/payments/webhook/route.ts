import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull } from '@/lib/stripe/client'
import { syncBillingByAccount } from '@/lib/stripe/billing'

/**
 * The only thing that may mark a payment paid.
 *
 * Signature verification on the raw body is the whole security model: parse
 * first and re-serialise, and the bytes change and it never verifies. A
 * session completing is not a payment: payment_status is. Refunds are
 * matched to the one row they were for (a family's checkout has a row per
 * child) by the metadata the refund route put on them, else to the intent.
 * The league's entry fee rides the same session event, told apart by its
 * metadata. 200 for anything ignored on purpose — Stripe retries a non-2xx
 * for days, and retrying what we chose to ignore is noise.
 */
export async function POST(request: Request) {
  const stripe = stripeOrNull()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  }
  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('No signature', { status: 400 })
  const raw = await request.text()

  let event
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad signature'
    console.error('stripe webhook rejected', message)
    return new Response('Bad signature', { status: 400 })
  }

  const admin = createAdminClient()

  switch (event.type) {
    // Accounts v2 raise no account.updated, but every capability change
    // arrives as a Connect event naming the account: read it back then.
    case 'capability.updated': {
      if (event.account) await syncBillingByAccount(event.account)
      break
    }

    // Classic accounts only; Accounts v2 are read back on demand (connect GET).
    case 'account.updated': {
      const account = event.data.object
      await admin
        .from('academy_billing')
        .update({
          charges_enabled: account.charges_enabled ?? false,
          payouts_enabled: account.payouts_enabled ?? false,
          details_submitted: account.details_submitted ?? false,
          requirements: (account.requirements ?? null) as never,
          connected_at: account.charges_enabled ? new Date().toISOString() : null,
        })
        .eq('stripe_account_id', account.id)
      break
    }

    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object
      // payment_status, not the session being complete. A session can finish
      // with the payment still processing — BECS direct debit takes days —
      // and calling that paid would tell a coach money had arrived when it
      // had not.
      if (session.payment_status !== 'paid') break
      const intent = typeof session.payment_intent === 'string' ? session.payment_intent : null
      if (session.metadata?.kind === 'entry_fee' && session.metadata.entry_fee_id) {
        await admin
          .from('entry_fees')
          .update({ status: 'paid', paid_at: new Date().toISOString(), method: 'stripe', stripe_payment_intent: intent })
          .eq('id', session.metadata.entry_fee_id)
          .eq('stripe_session_id', session.id)
        break
      }
      await admin
        .from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent: intent })
        .eq('stripe_session_id', session.id)
      break
    }

    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired': {
      const session = event.data.object
      // Only a pending row. A payment that already succeeded must never be
      // walked backwards by a late expiry event arriving out of order.
      await admin
        .from('payments')
        .update({ status: event.type.endsWith('failed') ? 'failed' : 'cancelled' })
        .eq('stripe_session_id', session.id)
        .eq('status', 'pending')
      break
    }

    // The refund route names the payment it was for; a family's checkout
    // has several rows on one intent and only that one is refunded. The
    // Refund object carries that name — the Charge no longer lists its
    // refunds on current API versions, so charge.refunded cannot.
    case 'refund.created':
    case 'refund.updated': {
      const refund = event.data.object
      const paymentId = refund.metadata?.payment_id
      if (refund.status !== 'succeeded' || !paymentId) break
      await admin.from('payments').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('id', paymentId)
      break
    }

    // A refund issued elsewhere (the club's own Stripe dashboard) names no
    // row; only a charge refunded in full is safe to apply to all of them.
    case 'charge.refunded': {
      const charge = event.data.object
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
      if (!intent || !charge.refunded) break
      await admin.from('payments').update({ status: 'refunded', refunded_at: new Date().toISOString() }).eq('stripe_payment_intent', intent).neq('status', 'refunded')
      break
    }
  }

  return NextResponse.json({ received: true })
}
