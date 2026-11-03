import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull } from '@/lib/stripe/client'

/**
 * What Stripe says about a club's connected account, written to
 * academy_billing. Accounts v2 raise no `account.updated`; the state is read
 * back on demand (the connect GET, when an owner returns from onboarding)
 * and whenever a capability event arrives on the webhook.
 */
export async function syncBilling(academyId: string, accountId: string) {
  const stripe = stripeOrNull()
  if (!stripe) return null
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'configuration.recipient', 'requirements'],
  })
  const charges = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active'
  const transfers = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === 'active'
  const entries = account.requirements?.entries ?? []
  const outstanding = entries.filter((e) => e.minimum_deadline?.status === 'currently_due' || e.minimum_deadline?.status === 'past_due')
  const row = {
    charges_enabled: charges,
    payouts_enabled: charges || transfers,
    details_submitted: outstanding.length === 0,
    requirements: { outstanding: outstanding.length, summary: account.requirements?.summary ?? null } as never,
    connected_at: charges ? new Date().toISOString() : null,
  }
  await createAdminClient().from('academy_billing').update(row).eq('academy_id', academyId).eq('stripe_account_id', accountId)
  return { ...row, account_id: accountId }
}

/** The same, for whichever academy holds the account a Connect event names. */
export async function syncBillingByAccount(accountId: string) {
  const { data } = await createAdminClient().from('academy_billing').select('academy_id').eq('stripe_account_id', accountId).maybeSingle()
  if (!data) return null
  return syncBilling(data.academy_id, accountId)
}
