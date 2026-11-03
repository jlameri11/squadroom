import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull, siteUrl } from '@/lib/stripe/client'

/**
 * A parent pays a request — for one child, or for all their children on it
 * at once (R-04, 3 Nov 2026): one Checkout Session, a line per child, a
 * payments row per child sharing the session. Each child's amount comes from
 * quote_payment in the parent's own session, so the sibling discount, the
 * voucher and the instalment schedule are the same ones the screen showed.
 *
 * No application fee, and no code path that could add one. Squadroom
 * charges clubs a plan; it takes nothing from a parent's payment. The charge
 * is created on the academy's own connected account, so the money goes
 * parent → club and we are never in the flow of funds.
 */
type Quote = { schedule: { seq: number; amount_cents: number; status: string }[] }

export async function POST(request: Request) {
  const stripe = stripeOrNull()
  if (!stripe) return NextResponse.json({ error: 'Payments are not set up yet.' }, { status: 503 })

  const body = await request.json().catch(() => null)
  const { requestId, playerId, playerIds } = (body ?? {}) as { requestId?: string; playerId?: string; playerIds?: string[] }
  if (!requestId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const children = [...new Set([...(playerIds ?? []), ...(playerId ? [playerId] : [])].filter(Boolean))]

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
  if (req.per_player && children.length === 0) {
    return NextResponse.json({ error: 'Choose which child this is for.' }, { status: 400 })
  }

  // Paying for a child who is not yours is not a thing that should require
  // imagination to prevent.
  if (children.length > 0) {
    const { data: mine } = await supabase.from('player_guardians').select('player_id').in('player_id', children).eq('profile_id', auth.user.id)
    const ok = new Set((mine ?? []).map((m) => m.player_id))
    if (children.some((c) => !ok.has(c))) return NextResponse.json({ error: 'That is not your child.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: billing } = await admin
    .from('academy_billing')
    .select('stripe_account_id, charges_enabled, currency')
    .eq('academy_id', req.academy_id)
    .maybeSingle()
  if (!billing?.stripe_account_id || !billing.charges_enabled) {
    return NextResponse.json({ error: 'This academy has not finished setting up payments yet.' }, { status: 409 })
  }

  // THE PRICE COMES FROM THE DATABASE, through the one function that knows
  // how to work it out — asked through the CALLER's session, because
  // quote_payment checks that this person is a guardian of this child.
  const { data: names } = children.length ? await admin.from('players').select('id, full_name').in('id', children) : { data: [] as { id: string; full_name: string }[] }
  const parts: { player_id: string | null; name: string | null; seq: number; amount_cents: number; count: number }[] = []
  for (const child of children.length ? children : [null]) {
    const { data: quote, error } = await supabase.rpc('quote_payment', { p_request: requestId, p_player: child ?? undefined })
    if (error || !quote) return NextResponse.json({ error: 'Could not work out what is owed.' }, { status: 500 })
    const schedule = (quote as Quote).schedule
    // The next part that has not been paid. One instalment per checkout: a
    // parent paying a term fee in four presses this four times over four
    // months, and each press must charge one part rather than the lot.
    const next = schedule.find((s) => s.status !== 'paid')
    if (!next) continue
    parts.push({ player_id: child, name: names?.find((n) => n.id === child)?.full_name ?? null, seq: next.seq, amount_cents: next.amount_cents, count: schedule.length })
  }
  if (parts.length === 0) return NextResponse.json({ error: 'This is already paid.' }, { status: 409 })
  const zero = parts.filter((p) => p.amount_cents === 0)
  if (zero.length === parts.length) return NextResponse.json({ error: 'Nothing to pay — a voucher covers it.' }, { status: 409 })

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // Cards only. Left to Stripe's defaults, an AU account also offers
      // Klarna, Zip and Link, which puts buy-now-pay-later on a junior
      // club's fee page — instalments are the club's own feature here, on
      // the club's terms, and a family sees one clear total. (Decided 3 Nov
      // 2026; one line to change if a club asks.)
      payment_method_types: ['card'],
      line_items: parts.filter((p) => p.amount_cents > 0).map((p) => ({
        quantity: 1,
        price_data: {
          currency: req.currency,
          unit_amount: p.amount_cents,
          product_data: {
            name: `${req.title}${p.name ? ` — ${p.name}` : ''}${p.count > 1 ? ` — part ${p.seq} of ${p.count}` : ''}`,
            description: req.description ?? undefined,
          },
        },
      })),
      success_url: `${siteUrl()}/payments?paid=1`,
      cancel_url: `${siteUrl()}/payments?cancelled=1`,
      // Everything the webhook needs to find the rows again. The webhook must
      // never have to trust anything the browser sends back.
      metadata: {
        kind: 'request',
        academy_id: req.academy_id,
        request_id: requestId,
        player_ids: parts.map((p) => p.player_id ?? '').join(','),
        profile_id: auth.user.id,
      },
    },
    { stripeAccount: billing.stripe_account_id }
  )

  // A pending row per child now, so a parent who closes the tab still sees
  // an attempt rather than nothing. The webhook is what turns it into 'paid'.
  for (const p of parts) {
    await admin.from('payments').upsert(
      {
        academy_id: req.academy_id,
        request_id: requestId,
        profile_id: auth.user.id,
        player_id: p.player_id,
        stripe_session_id: session.id,
        amount_cents: p.amount_cents,
        currency: req.currency,
        status: p.amount_cents === 0 ? 'paid' : 'pending',
        instalment_seq: p.seq,
        paid_at: p.amount_cents === 0 ? new Date().toISOString() : null,
      },
      { onConflict: 'request_id,player_id,instalment_seq' }
    )
  }

  return NextResponse.json({ url: session.url, session_id: session.id, children: parts.length, amount_cents: parts.reduce((n, p) => n + p.amount_cents, 0) })
}
