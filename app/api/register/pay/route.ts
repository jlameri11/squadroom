import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches, syntheticEmail } from '@/lib/join'
import { adoptEmail } from '@/lib/account-email'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * Pay now (the registration brief, gap 1; 0262): a program that charges on
 * submit. The family has just sent a registration from the public form and
 * holds its secret; this makes the account their mobile will sign into (the
 * approval would have made the same one), charges the program's fee on
 * Stripe Checkout on the club's own connected account, and writes the
 * payment against the REQUEST — the player does not exist until the club
 * approves. Approval then attaches the player; a decline refunds in full
 * without anyone tapping.
 *
 * The amount is the program's fee as the club set it, never the body's.
 * Nothing here grants anything: an account with no membership sees nothing.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, secret } = (body ?? {}) as { requestId?: string; secret?: string }
  if (!requestId || !secret) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const admin = createAdminClient()
  const { data: req } = await admin
    .from('registration_requests')
    .select('id, academy_id, program_id, status, secret_hash, guardian_name, guardian_phone, guardian_email, child_name, profile_id, expires_at')
    .eq('id', requestId)
    .maybeSingle()
  if (!req || !secretMatches(secret, req.secret_hash)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') return NextResponse.json({ error: `This registration is ${req.status}.` }, { status: 409 })
  if (new Date(req.expires_at) < new Date()) return NextResponse.json({ error: 'This registration has lapsed — register again.' }, { status: 409 })

  const { data: program } = await admin
    .from('programs')
    .select('id, name, pay_timing, payment_required, payment_request_id')
    .eq('id', req.program_id)
    .maybeSingle()
  const { data: fee } = program?.payment_request_id
    ? await admin.from('payment_requests').select('id, title, amount_cents, currency, description').eq('id', program.payment_request_id).maybeSingle()
    : { data: null }
  if (!program || program.pay_timing !== 'now' || !program.payment_required || !fee || fee.amount_cents <= 0) {
    return NextResponse.json({ error: 'This program is paid once the club accepts the registration.' }, { status: 409 })
  }
  // Paid or paying already: one charge per registration.
  const { data: already } = await admin.from('payments').select('id, status').eq('registration_request_id', req.id).in('status', ['paid', 'processing', 'pending'])
  if ((already ?? []).some((p) => p.status === 'paid' || p.status === 'processing')) {
    return NextResponse.json({ error: 'This registration is already paid.' }, { status: 409 })
  }
  if (!req.guardian_phone) return NextResponse.json({ error: 'A mobile number is needed to pay now — the club will take it after approval.' }, { status: 409 })

  const { data: billing } = await admin.from('academy_billing').select('stripe_account_id, charges_enabled').eq('academy_id', req.academy_id).maybeSingle()
  if (!billing?.stripe_account_id || !billing.charges_enabled) {
    return NextResponse.json({ error: 'This club has not finished setting up payments yet — they will take the fee once they accept.' }, { status: 409 })
  }
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not set up.' }, { status: 503 })

  // The account the family's mobile will sign into — the one approval makes.
  let profileId = req.profile_id
  if (!profileId) {
    const { data: existing } = await admin.from('profiles').select('id').eq('phone', req.guardian_phone).maybeSingle()
    profileId = existing?.id ?? null
    if (!profileId) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: req.guardian_email ?? syntheticEmail(req.guardian_phone),
        phone: req.guardian_phone,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: req.guardian_name },
      })
      if (error || !created.user) return NextResponse.json({ error: 'Could not create the account to pay from.' }, { status: 500 })
      profileId = created.user.id
      await admin.from('profiles').upsert({ id: profileId, full_name: req.guardian_name, phone: req.guardian_phone })
      await adoptEmail(admin, profileId, req.guardian_email)
    }
    await admin.from('registration_requests').update({ profile_id: profileId }).eq('id', req.id)
  }

  const { data: club } = await admin.from('academies').select('slug').eq('id', req.academy_id).single()
  // A fee of this registration's own until the club decides: payments keep
  // one row per request, player and instalment, and two children paid on
  // submit have no player yet. Approval moves the payment onto the program's
  // fee and the child; this stays as the record of what was asked.
  const { data: own, error: ownErr } = await admin
    .from('payment_requests')
    .insert({ academy_id: req.academy_id, title: `${fee.title} — ${req.child_name}`, description: 'Paid on registration, before the club decided.', amount_cents: fee.amount_cents, currency: fee.currency, per_player: false, created_by: profileId })
    .select('id')
    .single()
  if (ownErr || !own) return NextResponse.json({ error: 'Could not record the fee to pay.' }, { status: 500 })
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: fee.currency,
          unit_amount: fee.amount_cents,
          product_data: { name: `${fee.title} — ${req.child_name}`, description: fee.description ?? `${program.name}: refunded in full if the club cannot take the registration.` },
        },
      }],
      success_url: `${siteUrl()}/${club?.slug ?? ''}/register?paid=1`,
      cancel_url: `${siteUrl()}/${club?.slug ?? ''}/register?cancelled=1`,
      metadata: { kind: 'registration', academy_id: req.academy_id, request_id: own.id, registration_request_id: req.id, profile_id: profileId },
    },
    { stripeAccount: billing.stripe_account_id }
  )
  const { error: payErr } = await admin.from('payments').insert({
    academy_id: req.academy_id,
    request_id: own.id,
    profile_id: profileId,
    player_id: null,
    registration_request_id: req.id,
    stripe_session_id: session.id,
    amount_cents: fee.amount_cents,
    currency: fee.currency,
    status: 'pending',
    instalment_seq: 1,
  })
  if (payErr) return NextResponse.json({ error: `Could not record the payment: ${payErr.message}` }, { status: 500 })
  return NextResponse.json({ url: session.url, session_id: session.id, amount_cents: fee.amount_cents })
}
