import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * Starts or resumes Stripe onboarding for an academy.
 *
 * Express accounts mean Stripe collects the bank details, the ABN and the
 * identity documents on their own hosted pages. Squadroom never sees any of
 * it, which is the entire reason for choosing Express over building our own
 * forms — a football app has no business holding a treasurer's licence photo.
 *
 * Account links expire in minutes and are single use, so this is called every
 * time the owner presses the button rather than a URL being stored anywhere.
 */
export async function POST(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Payments are not configured on this deployment.' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => null)
  const academyId = (body as { academyId?: string } | null)?.academyId
  if (!academyId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Only an owner or admin may connect a bank account to an academy. RLS on
  // academy_billing says exactly that, so a successful write IS the check —
  // but this table may have no row yet, so ask directly.
  const { data: role } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academyId)
    .eq('profile_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!role || (role.role !== 'owner' && role.role !== 'admin')) {
    return NextResponse.json(
      { error: 'Only an owner or admin can set up payments.' },
      { status: 403 }
    )
  }

  const admin = createAdminClient()
  const { data: academy } = await admin
    .from('academies')
    .select('name')
    .eq('id', academyId)
    .single()

  const { data: existing } = await admin
    .from('academy_billing')
    .select('stripe_account_id')
    .eq('academy_id', academyId)
    .maybeSingle()

  let accountId = existing?.stripe_account_id ?? null

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'AU',
      business_profile: {
        name: academy?.name ?? 'Football academy',
        product_description: 'Junior football fees, tournament entries and club items',
      },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      // Direct charges: the academy is the merchant of record, so their name
      // is what a parent sees on their statement rather than ours.
      settings: { payouts: { schedule: { interval: 'daily' } } },
      metadata: { academy_id: academyId },
    })
    accountId = account.id

    await admin.from('academy_billing').upsert(
      { academy_id: academyId, stripe_account_id: accountId },
      { onConflict: 'academy_id' }
    )
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    // Both point back at the same screen. Stripe sends people to `refresh`
    // when the link expired, and the screen simply offers the button again.
    refresh_url: `${siteUrl()}/settings/academy?payments=refresh`,
    return_url: `${siteUrl()}/settings/academy?payments=done`,
    type: 'account_onboarding',
  })

  return NextResponse.json({ url: link.url })
}
