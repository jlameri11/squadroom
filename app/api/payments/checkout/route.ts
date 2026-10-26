import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * Sends a parent to Stripe to pay one request, for one child.
 *
 * A DIRECT charge, created on the academy's own connected account. The money
 * lands in their balance, their name is on the parent's statement, and
 * Squadroom is never in the flow of funds. The `stripeAccount` option is what
 * makes it direct rather than a charge on us.
 *
 * The amount is read from the DATABASE, never from the request body. Taking a
 * price from the client is how somebody pays $0.50 for a $50 gala day, and it
 * is the single most common way a checkout gets abused.
 */
export async function POST(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Payments are not set up yet.' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => null)
  const { requestId, playerId } = (body ?? {}) as { requestId?: string; playerId?: string }
  if (!requestId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // If RLS hides the request, this person has no business paying it — it is
  // for another team, another academy, or archived.
  const { data: req } = await supabase
    .from('payment_requests')
    .select('id, academy_id, title, description, amount_cents, currency, per_player, closes_at, archived_at')
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.archived_at) return NextResponse.json({ error: 'This is closed.' }, { status: 409 })
  if (req.closes_at && new Date(req.closes_at) < new Date()) {
    return NextResponse.json({ error: 'This closed on ' + req.closes_at.slice(0, 10) }, { status: 409 })
  }
  if (req.per_player && !playerId) {
    return NextResponse.json({ error: 'Choose which child this is for.' }, { status: 400 })
  }

  // Paying for a child who is not yours is not a thing that should require
  // imagination to prevent.
  if (playerId) {
    const { data: mine } = await supabase
      .from('player_guardians')
      .select('player_id')
      .eq('player_id', playerId)
      .eq('profile_id', auth.user.id)
      .maybeSingle()
    if (!mine) return NextResponse.json({ error: 'That is not your child.' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: billing } = await admin
    .from('academy_billing')
    .select('stripe_account_id, charges_enabled, currency')
    .eq('academy_id', req.academy_id)
    .maybeSingle()

  if (!billing?.stripe_account_id || !billing.charges_enabled) {
    return NextResponse.json(
      { error: 'This academy has not finished setting up payments yet.' },
      { status: 409 }
    )
  }

  // THE PRICE COMES FROM THE DATABASE, through the one function that knows
  // how to work it out.
  //
  // 0102 added sibling discounts and instalments, so `amount_cents` is no
  // longer the price — it is the input to one. Asked through the CALLER's
  // session rather than the service role, because quote_payment checks that
  // this person is a guardian of this child, and under the service role
  // auth.uid() is null and that check cannot mean anything.
  //
  // A discount the parent's screen shows and this route ignores would charge
  // a family the wrong amount, which is worse than having no discount at
  // all — so both ask the same function.
  const { data: quote, error: quoteError } = await supabase.rpc('quote_payment', {
    p_request: requestId,
    p_player: playerId ?? undefined,
  })

  if (quoteError || !quote) {
    return NextResponse.json({ error: 'Could not work out what is owed.' }, { status: 500 })
  }

  const schedule = (quote as { schedule: { seq: number; amount_cents: number; status: string }[] })
    .schedule
  // The next part that has not been paid. One instalment per checkout: a
  // parent paying a term fee in four presses this four times over four
  // months, and each press must charge one part rather than the lot.
  const next = schedule.find((s) => s.status !== 'paid')

  if (!next) {
    return NextResponse.json({ error: 'This is already paid.' }, { status: 409 })
  }

  const amountCents = next.amount_cents
  const instalmentSeq = next.seq
  const partLabel =
    schedule.length > 1 ? ` — part ${instalmentSeq} of ${schedule.length}` : ''

  // No application fee, and no code path that could add one. Squadroom
  // charges clubs a plan; it takes nothing from a parent's payment. The
  // charge is created on the academy's own connected account, so the money
  // goes parent -> club and we are never in the flow of funds.

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: req.currency,
            unit_amount: amountCents,
            product_data: {
              name: `${req.title}${partLabel}`,
              description: req.description ?? undefined,
            },
          },
        },
      ],
      success_url: `${siteUrl()}/payments?paid=1`,
      cancel_url: `${siteUrl()}/payments?cancelled=1`,
      // Everything the webhook needs to find the row again. The webhook must
      // never have to trust anything the browser sends back.
      metadata: {
        academy_id: req.academy_id,
        request_id: requestId,
        player_id: playerId ?? '',
        profile_id: auth.user.id,
        instalment_seq: String(instalmentSeq),
      },
    },
    { stripeAccount: billing.stripe_account_id }
  )

  // A pending row now, so a parent who closes the tab still sees an attempt
  // rather than nothing. The webhook is what turns it into 'paid'.
  await admin.from('payments').upsert(
    {
      academy_id: req.academy_id,
      request_id: requestId,
      profile_id: auth.user.id,
      player_id: playerId ?? null,
      stripe_session_id: session.id,
      amount_cents: amountCents,
      currency: req.currency,
      status: 'pending',
      instalment_seq: instalmentSeq,
    },
    { onConflict: 'request_id,player_id,instalment_seq' }
  )

  return NextResponse.json({ url: session.url })
}
