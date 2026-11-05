import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { siteUrl } from '@/lib/site'

/**
 * The one-tap link from a confirmation email (0214).
 *
 * The token is the proof — whoever holds it read the inbox — so this needs no
 * session: the link works on the phone where the email was opened. It
 * confirms the address only if it is still the one the account has (an
 * address changed since the link was sent stays unconfirmed), and each link
 * works once, for seven days.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? ''
  const done = (state: string) => NextResponse.redirect(`${siteUrl()}/settings?email=${state}`)
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return done('link-broken')

  const admin = createAdminClient()
  const hash = createHash('sha256').update(token).digest('hex')
  const { data: row } = await admin.from('email_confirmations').select('*').eq('token_hash', hash).maybeSingle()
  if (!row) return done('link-broken')
  if (row.used_at) return done('already-confirmed')
  if (new Date(row.expires_at) < new Date()) return done('link-expired')

  const now = new Date().toISOString()
  await admin.from('email_confirmations').update({ used_at: now }).eq('token_hash', hash)
  const { data: confirmed } = await admin
    .from('account_emails')
    .update({ verified_at: now })
    .eq('profile_id', row.profile_id)
    .eq('email', row.email)
    .select('profile_id')
  return done(confirmed && confirmed.length > 0 ? 'confirmed' : 'address-changed')
}
