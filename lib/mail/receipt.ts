import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { escapeHtml, fromAs, mailConfigured, sendEach } from '@/lib/mail/resend'
import { siteUrl } from '@/lib/stripe/client'

/**
 * The emailed receipt (the registration brief, gap 9; 0270). Sent by the
 * webhook once a payment is paid, to the payer's account email — when
 * Squadroom has a Resend key. Without one nothing happens and nothing says
 * so (NEEDS JOEY #19): the receipt is on screen at /receipts/<id>, and a
 * push said so the moment the payment landed (the 0270 trigger).
 */
export async function sendReceiptEmail(admin: SupabaseClient<Database>, paymentId: string): Promise<boolean> {
  if (!mailConfigured()) return false
  const { data: pay } = await admin
    .from('payments')
    .select('id, academy_id, profile_id, player_id, request_id, amount_cents, card_fee_cents, currency, paid_at, stripe_payment_intent')
    .eq('id', paymentId)
    .maybeSingle()
  if (!pay?.profile_id) return false
  const [{ data: email }, { data: club }, { data: fee }, { data: child }] = await Promise.all([
    admin.from('account_emails').select('email').eq('profile_id', pay.profile_id).maybeSingle(),
    admin.from('academies').select('name').eq('id', pay.academy_id).maybeSingle(),
    admin.from('payment_requests').select('title').eq('id', pay.request_id).maybeSingle(),
    pay.player_id ? admin.from('players').select('full_name').eq('id', pay.player_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const to = (email as { email?: string } | null)?.email
  if (!to || !club) return false
  const money = (c: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: pay.currency.toUpperCase() }).format(c / 100)
  const total = pay.amount_cents + (pay.card_fee_cents ?? 0)
  const url = `${siteUrl()}/receipts/${pay.id}`
  const lines = [
    `${money(total)} paid to ${club.name}.`,
    `For: ${fee?.title ?? 'a fee'}${child ? ` — ${child.full_name}` : ''}.`,
    pay.card_fee_cents ? `Includes a card processing fee of ${money(pay.card_fee_cents)}.` : null,
    pay.stripe_payment_intent ? `Stripe payment id: ${pay.stripe_payment_intent}.` : null,
    `Your receipt: ${url}`,
    '',
    `Paid to ${club.name} through Stripe, into the club's own account. Squadroom holds none of it and adds nothing to it.`,
  ].filter((l): l is string => l !== null)
  const html = `<p>${lines.slice(0, -2).map(escapeHtml).join('<br>')}</p><p><a href="${url}">Your receipt</a></p><p style="color:#666">${escapeHtml(lines[lines.length - 1])}</p>`
  const [id] = await sendEach([{ from: fromAs(`${club.name} via Squadroom`), to, subject: `Receipt: ${money(total)} to ${club.name}`, text: lines.join('\n'), html }])
  return Boolean(id)
}
