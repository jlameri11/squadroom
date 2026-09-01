import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull } from '@/lib/stripe/client'

/**
 * Stripe telling us what actually happened.
 *
 * This is the ONLY thing allowed to mark a payment paid. A browser returning
 * to /payments?paid=1 is a claim, not a fact — anyone can type that URL, and
 * a parent whose phone died between the card and the redirect has still paid.
 * So the success page says "checking with your bank" and this says paid.
 *
 * The signature check is the whole security model. Without it this is an
 * open endpoint where anyone who knows a request id can mark a season's fees
 * settled, so an unverified body is never read, never logged, never parsed.
 *
 * Connected-account events arrive here too (the charge lives on the academy's
 * account, not ours) and carry the same signing secret.
 */
export async function POST(request: Request) {
  const stripe = stripeOrNull()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('No signature', { status: 400 })

  // The RAW body. Parsing it first and re-serialising changes the bytes and
  // the signature will never verify.
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
    // Onboarding progress. An academy can submit everything and still not be
    // able to charge for days while identity checks run, so these three flags
    // are stored separately rather than collapsed into "connected".
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

    case 'checkout.session.completed': {
      const session = event.data.object
      // payment_status, not the session being complete. A session can finish
      // with the payment still processing — BECS direct debit takes days —
      // and calling that paid would tell a coach money had arrived when it
      // had not.
      if (session.payment_status !== 'paid') break

      await admin
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
        })
        .eq('stripe_session_id', session.id)
      break
    }

    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object
      await admin
        .from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
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

    case 'charge.refunded': {
      const charge = event.data.object
      const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
      if (!intent) break
      await admin
        .from('payments')
        .update({ status: 'refunded', refunded_at: new Date().toISOString() })
        .eq('stripe_payment_intent', intent)
      break
    }
  }

  // 200 for anything we chose not to act on. Stripe retries a non-2xx for
  // days, and retrying an event we deliberately ignore is noise that hides
  // the ones that genuinely failed.
  return NextResponse.json({ received: true })
}
