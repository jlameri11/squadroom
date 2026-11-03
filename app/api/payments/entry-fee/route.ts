import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * A club pays a competition's entry fee online (L-02 / L-16, the Stripe
 * half). The session is on the LEAGUE's connected account — the league is
 * the merchant, the club is the customer, Squadroom is neither. The
 * entry_fees row remembers the session so the webhook can mark it paid.
 */
export async function POST(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not set up yet.' }, { status: 503 })
  const body = await request.json().catch(() => null)
  const { feeId } = (body ?? {}) as { feeId?: string }
  if (!feeId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // RLS: the fee is readable by the league's organisers and the club's staff.
  const { data: fee } = await supabase.from('entry_fees').select('id, competition_id, entry_id, academy_id, club_academy_id, amount_cents, status').eq('id', feeId).maybeSingle()
  if (!fee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (fee.status !== 'owed') return NextResponse.json({ error: `Already ${fee.status}.` }, { status: 409 })
  if (fee.amount_cents === 0) return NextResponse.json({ error: 'Nothing to pay.' }, { status: 409 })
  if (!fee.club_academy_id) return NextResponse.json({ error: 'This entry is not linked to a club yet.' }, { status: 409 })

  // The payer must be staff of the entering club, not just able to see the fee.
  const { data: role } = await supabase.from('academy_members').select('role').eq('academy_id', fee.club_academy_id).eq('profile_id', auth.user.id).eq('status', 'active').maybeSingle()
  if (!role || !['owner', 'admin'].includes(role.role)) {
    return NextResponse.json({ error: "Only the club's owner or admin pays its entry fee." }, { status: 403 })
  }

  const admin = createAdminClient()
  const [{ data: billing }, { data: comp }, { data: entry }] = await Promise.all([
    admin.from('academy_billing').select('stripe_account_id, charges_enabled').eq('academy_id', fee.academy_id).maybeSingle(),
    admin.from('competitions').select('name').eq('id', fee.competition_id).single(),
    admin.from('competition_entries').select('display_name, division').eq('id', fee.entry_id).single(),
  ])
  if (!billing?.stripe_account_id || !billing.charges_enabled) {
    return NextResponse.json({ error: 'The league has not finished setting up payments yet. Pay by bank transfer and the league will tick it off.' }, { status: 409 })
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // Cards only, as for a family's checkout (see checkout/route.ts).
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'aud',
          unit_amount: fee.amount_cents,
          product_data: { name: `${comp?.name ?? 'Competition'} — entry fee`, description: `${entry?.display_name ?? 'Team'}${entry?.division ? ` · ${entry.division}` : ''}` },
        },
      }],
      success_url: `${siteUrl()}/competitions/${fee.competition_id}?paid=1`,
      cancel_url: `${siteUrl()}/competitions/${fee.competition_id}?cancelled=1`,
      metadata: { kind: 'entry_fee', entry_fee_id: fee.id, competition_id: fee.competition_id, club_academy_id: fee.club_academy_id, profile_id: auth.user.id },
    },
    { stripeAccount: billing.stripe_account_id }
  )
  await admin.from('entry_fees').update({ stripe_session_id: session.id }).eq('id', fee.id)
  return NextResponse.json({ url: session.url, session_id: session.id, amount_cents: fee.amount_cents })
}
