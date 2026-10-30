import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripeOrNull } from '@/lib/stripe/client'

/**
 * L-07: pay a referee run through Stripe.
 *
 * Referees are paid BY THE LEAGUE, so the transfers leave the league's
 * connected account (academy_billing) and land in each referee's own
 * connected account (referees.stripe_account_id — the referee's onboarding
 * is L-25). Without a key, or a league account, or a referee account, the
 * route says so plainly and the treasurer pays by bank transfer and marks
 * the run paid instead. Nothing here guesses.
 */
export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const { runId } = (body ?? {}) as { runId?: string }
  if (!runId) return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  // The organiser's own client: RLS on the run is the authorisation check.
  const supabase = await createClient()
  const { data: run } = await supabase
    .from('referee_payment_runs')
    .select('id, academy_id, competition_id, status, total_cents')
    .eq('id', runId)
    .maybeSingle()
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (run.status !== 'draft') return NextResponse.json({ error: `Already ${run.status}` }, { status: 409 })

  const admin = createAdminClient()
  const stripe = stripeOrNull()
  const { data: billing } = await admin.from('academy_billing').select('stripe_account_id, payouts_enabled').eq('academy_id', run.academy_id).maybeSingle()
  if (!stripe || !billing?.stripe_account_id) {
    return NextResponse.json(
      { error: "Stripe isn't set up for this league yet. Pay by bank transfer and mark the run paid." },
      { status: 503 }
    )
  }

  const { data: items } = await admin
    .from('referee_payment_items')
    .select('id, amount_cents, status, referee:referees(id, full_name, stripe_account_id)')
    .eq('run_id', runId)
    .eq('status', 'pending')
  const missing = (items ?? []).filter((i) => !i.referee?.stripe_account_id).map((i) => i.referee?.full_name)
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no Stripe account yet. Pay by bank transfer, or wait for them to connect one.` },
      { status: 409 }
    )
  }

  const paid: string[] = []
  const failed: string[] = []
  for (const item of items ?? []) {
    if (item.amount_cents === 0) {
      paid.push(item.id)
      continue
    }
    try {
      const transfer = await stripe.transfers.create(
        { amount: item.amount_cents, currency: 'aud', destination: item.referee!.stripe_account_id!, metadata: { referee_payment_item: item.id } },
        { stripeAccount: billing.stripe_account_id }
      )
      await admin.from('referee_payment_items').update({ status: 'paid', paid_at: new Date().toISOString(), stripe_transfer_id: transfer.id }).eq('id', item.id)
      paid.push(item.id)
    } catch (e) {
      failed.push(`${item.referee?.full_name}: ${e instanceof Error ? e.message : 'Stripe refused the transfer'}`)
    }
  }
  if (failed.length === 0) {
    await admin.from('referee_payment_runs').update({ status: 'paid', paid_at: new Date().toISOString(), paid_method: 'stripe' }).eq('id', runId)
  }
  return NextResponse.json({ ok: failed.length === 0, paid: paid.length, failed }, { status: failed.length ? 502 : 200 })
}
