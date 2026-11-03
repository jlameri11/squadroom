import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * A referee connects their own Stripe account to be paid by a league
 * (L-07, the Stripe half). A recipient-only account: it receives transfers
 * and pays out to the referee's bank; it never charges anyone. Dashboard
 * 'none' — Stripe collects what it needs through the hosted onboarding and
 * the referee never has to make a Stripe login. One account per person,
 * written on every referee row of theirs, so every league that lists them
 * pays the same account.
 */
async function me() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  return auth.user ? { id: auth.user.id, email: auth.user.email ?? null } : null
}

export async function GET() {
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured on this deployment.' }, { status: 503 })
  const user = await me()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const userId = user.id
  const admin = createAdminClient()
  const { data: rows } = await admin.from('referees').select('stripe_account_id').eq('profile_id', userId).not('stripe_account_id', 'is', null).limit(1)
  const accountId = rows?.[0]?.stripe_account_id ?? null
  if (!accountId) return NextResponse.json({ connected: false, started: false })
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ['configuration.recipient', 'requirements'] })
  const ready = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active'
  const outstanding = (account.requirements?.entries ?? []).filter((e) => e.minimum_deadline?.status === 'currently_due' || e.minimum_deadline?.status === 'past_due').length
  return NextResponse.json({ connected: ready, started: true, outstanding })
}

export async function POST() {
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured on this deployment.' }, { status: 503 })
  const user = await me()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const userId = user.id
  const admin = createAdminClient()
  const { data: rows } = await admin.from('referees').select('id, full_name, stripe_account_id').eq('profile_id', userId)
  if (!rows || rows.length === 0) return NextResponse.json({ error: 'You are not on a referee list yet.' }, { status: 403 })
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', userId).single()

  let accountId = rows.find((r) => r.stripe_account_id)?.stripe_account_id ?? null
  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      display_name: profile?.full_name ?? rows[0].full_name,
      contact_email: user.email ?? `referee-${userId.slice(0, 8)}@squadroom.invalid`,
      dashboard: 'none',
      // A recipient-only account: Stripe allows only the platform as fees
      // and losses collector here. It receives transfers and pays out; it
      // never charges anyone, so there are no fees or losses to speak of.
      defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
      identity: { country: 'AU', entity_type: 'individual' },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      metadata: { profile_id: userId, role: 'referee' },
      include: ['configuration.recipient', 'requirements'],
    })
    accountId = account.id
    await admin.from('referees').update({ stripe_account_id: accountId }).eq('profile_id', userId)
  }

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['recipient'],
        refresh_url: `${siteUrl()}/referee?connect=refresh`,
        return_url: `${siteUrl()}/referee?connect=return`,
      },
    },
  })
  return NextResponse.json({ url: link.url, account_id: accountId })
}
