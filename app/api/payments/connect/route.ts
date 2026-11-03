import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'
import { syncBilling } from '@/lib/stripe/billing'

/**
 * A club connects its own Stripe account, and we read back where it is up to.
 *
 * ACCOUNTS v2, EXPRESS (3 Nov 2026). Stripe no longer lets a new platform
 * create the old `type: 'express'` account; the same thing is now spelled
 * `dashboard: 'express'` with `fees_collector: 'application_express'`
 * (Express pricing — Stripe's fee comes out of the club's charge, as it
 * always did; Squadroom adds nothing) and `losses_collector:
 * 'application'` (the platform stands behind a negative balance, as every
 * Express platform always has — a dispute is debited from the club's
 * balance first). The club gets the light Express dashboard for payouts;
 * direct charges on the club's account work exactly as before. The other
 * shapes Stripe offers here either hand the fees to the platform (which
 * would force an application fee, forbidden by the pricing rule) or make
 * the club open a full Stripe account.
 *
 * Accounts v2 raises no `account.updated` webhook on the classic queue, so
 * the status is read back on demand (GET) — the payments screen asks when
 * the owner comes back from onboarding — and on each `capability.updated`
 * the webhook receives (lib/stripe/billing.ts).
 *
 * Stripe owns requirement collection for an Express account: once the
 * onboarding link exists, the API refuses to write its identity, people or
 * terms acceptance, and the hosted pages sit behind a captcha. So the
 * end-to-end suite proves this route and then moves money on a test-mode
 * account of the one shape the platform may fill in itself
 * (scripts/_stripe-test-accounts.mjs).
 */
type Billing = { stripe_account_id: string | null }

async function requireAdmin(academyId: string) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  const { data: role } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academyId)
    .eq('profile_id', auth.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!role || (role.role !== 'owner' && role.role !== 'admin')) {
    return { error: NextResponse.json({ error: 'Only an owner or admin can set up payments.' }, { status: 403 }) }
  }
  return { userId: auth.user.id, email: auth.user.email ?? null }
}

export async function GET(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured on this deployment.' }, { status: 503 })
  const academyId = new URL(request.url).searchParams.get('academyId') ?? ''
  if (!academyId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const gate = await requireAdmin(academyId)
  if ('error' in gate) return gate.error
  const { data: billing } = await createAdminClient().from('academy_billing').select('stripe_account_id').eq('academy_id', academyId).maybeSingle<Billing>()
  if (!billing?.stripe_account_id) return NextResponse.json({ started: false })
  const status = await syncBilling(academyId, billing.stripe_account_id)
  return NextResponse.json({ started: true, ...status })
}

export async function POST(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) {
    return NextResponse.json({ error: 'Payments are not configured on this deployment.' }, { status: 503 })
  }
  const body = await request.json().catch(() => null)
  const academyId = (body as { academyId?: string } | null)?.academyId
  if (!academyId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const gate = await requireAdmin(academyId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: academy } = await admin.from('academies').select('name, slug').eq('id', academyId).single()
  const { data: existing } = await admin.from('academy_billing').select('stripe_account_id').eq('academy_id', academyId).maybeSingle<Billing>()

  let accountId = existing?.stripe_account_id ?? null
  // A placeholder from an old test ('acct_test_…') is not an account.
  if (accountId && !/^acct_[A-Za-z0-9]{10,}$/.test(accountId)) accountId = null

  if (!accountId) {
    const account = await stripe.v2.core.accounts.create({
      display_name: academy?.name ?? 'Football club',
      // Stripe insists on a contact for an account that can receive money;
      // the person setting it up is the club's contact until they change it.
      contact_email: gate.email ?? `${academy?.slug ?? 'club'}@squadroom.invalid`,
      dashboard: 'express',
      defaults: { responsibilities: { fees_collector: 'application_express', losses_collector: 'application' } },
      identity: { country: 'AU', entity_type: 'company' },
      configuration: {
        merchant: {
          capabilities: { card_payments: { requested: true } },
          // Direct charges: the club is the merchant of record, so their name
          // is what a parent sees on their statement rather than ours.
          support: undefined,
        },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      metadata: { academy_id: academyId, slug: academy?.slug ?? '' },
      include: ['configuration.merchant', 'requirements'],
    })
    accountId = account.id
    await admin.from('academy_billing').upsert({ academy_id: academyId, stripe_account_id: accountId, charges_enabled: false, payouts_enabled: false }, { onConflict: 'academy_id' })
  }

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'recipient'],
        // Both point back at the same screen. Stripe sends people to `refresh`
        // when a link has expired, and to `return` when they are done.
        refresh_url: `${siteUrl()}/admin/payments?connect=refresh`,
        return_url: `${siteUrl()}/admin/payments?connect=return`,
      },
    },
  })

  return NextResponse.json({ url: link.url, account_id: accountId })
}
