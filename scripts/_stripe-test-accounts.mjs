// Test-mode Stripe accounts the API can activate outright, for the
// end-to-end suite (scripts/test-stripe-e2e.mjs). TEST MODE ONLY: refuses
// any key that is not sk_test_.
//
// Why these exist. A club's real account is an Express one
// (app/api/payments/connect/route.ts) and Stripe owns its requirement
// collection: the hosted onboarding, which in test mode offers "Use test
// phone number" and the like but sits behind a captcha that a scripted
// browser cannot pass ("Challenge closed. Please try again", 3 Nov 2026),
// and the API refuses to write its identity, people or terms acceptance
// ("requirement collection is owned by Stripe"). So the suite proves the
// route — account and onboarding link — and then moves the money on an
// account of the one shape the platform may fill in itself: no dashboard,
// platform collecting fees and losses, Stripe's test values for identity
// and a test bank account. Stripe activates it at once.
//
// The shape is irrelevant to every line of ours that moves money: direct
// charges, refunds and transfers address an account by id. It is never
// used outside this harness, and the suite closes what it made.
import Stripe from 'stripe'

export const API_VERSION = '2026-08-26.dahlia'
const ADDRESS = { country: 'AU', line1: 'address_full_match', city: 'North Ryde', state: 'NSW', postal_code: '2113' }
const BORN_VERIFIED = { day: 1, month: 1, year: 1901 }
const TEST_BANK = { object: 'bank_account', country: 'AU', currency: 'aud', routing_number: '110000', account_number: '000123456' }

export function testStripe() {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!key.startsWith('sk_test_')) throw new Error('test mode only: STRIPE_SECRET_KEY must be an sk_test_ key')
  return new Stripe(key, { apiVersion: API_VERSION })
}

const attested = () => ({ terms_of_service: { account: { date: new Date().toISOString(), ip: '127.0.0.1', user_agent: 'squadroom-test-harness' } } })
const individual = (name, email, phone) => {
  const [given_name, ...rest] = name.split(' ')
  return { given_name, surname: rest.join(' ') || 'Tester', email, phone, date_of_birth: BORN_VERIFIED, address: ADDRESS }
}

/** Every open connected account on the platform (id, display_name, dashboard, metadata). */
export async function openAccounts() {
  const auth = { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'Stripe-Version': API_VERSION }
  const out = []
  let url = 'https://api.stripe.com/v2/core/accounts?limit=20'
  for (let page = 0; page < 10 && url; page++) {
    const res = await (await fetch(url, { headers: auth })).json()
    for (const a of res.data ?? []) if (!a.closed_at) out.push({ id: a.id, display_name: a.display_name, dashboard: a.dashboard, metadata: a.metadata ?? {} })
    url = res.next_page_url ? `https://api.stripe.com${res.next_page_url}` : null
  }
  return out
}
export const isHarness = (a) => a?.metadata?.test_harness === 'true'

async function findHarness(key, value) {
  return (await openAccounts()).find((a) => isHarness(a) && a.metadata[key] === value)?.id ?? null
}

async function activated(stripe, id) {
  for (let i = 0; i < 10; i++) {
    const a = await stripe.v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'configuration.recipient'] })
    const cards = a.configuration?.merchant?.capabilities?.card_payments?.status
    const transfers = a.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status
    if (cards === 'active' && transfers === 'active') return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

/** A club's stand-in: takes card payments, receives transfers, pays out. Reused across runs. */
export async function testMerchantAccount(stripe, { academyId, name, email, url }) {
  const existing = await findHarness('academy_id', academyId)
  if (existing && (await activated(stripe, existing))) return { id: existing, reused: true }
  const account = await stripe.v2.core.accounts.create({
    display_name: `${name} (test harness)`,
    contact_email: email,
    dashboard: 'none',
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' }, profile: { business_url: url }, currency: 'aud', locales: ['en-AU'] },
    identity: {
      country: 'AU',
      entity_type: 'individual',
      individual: individual('Test Treasurer', email, '+61400000002'),
      business_details: { phone: '+61400000002', address: ADDRESS, registered_name: name },
      attestations: attested(),
    },
    configuration: {
      merchant: { mcc: '7941', capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    metadata: { test_harness: 'true', academy_id: academyId },
  })
  await stripe.accounts.createExternalAccount(account.id, { external_account: { ...TEST_BANK, account_holder_name: name } })
  if (!(await activated(stripe, account.id))) throw new Error(`${account.id} did not activate`)
  return { id: account.id, reused: false }
}

/** Close any connected account this platform made (harness or route), whatever its configurations. */
export async function closeTestAccount(stripe, id) {
  if (!id) return 'nothing to close'
  try {
    const a = await stripe.v2.core.accounts.retrieve(id, { include: ['configuration.merchant', 'configuration.recipient'] })
    if (a.closed_at) return 'already closed'
    const applied = ['merchant', 'recipient'].filter((c) => a.configuration?.[c])
    await stripe.v2.core.accounts.close(id, { applied_configurations: applied })
    return 'closed'
  } catch (e) {
    return `not closed: ${String(e.message ?? e).slice(0, 140)}`
  }
}
