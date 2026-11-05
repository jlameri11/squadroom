import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml, fromAs, mailConfigured, sendEach } from '@/lib/mail/resend'
import { siteUrl } from '@/lib/site'

/**
 * Send the one-tap link that confirms a person's email (0214).
 *
 * For the signed-in person and their own address only. Without
 * RESEND_API_KEY nothing is sent and nothing says so — the address is saved
 * and simply not confirmed yet (NEEDS JOEY #19). Three links an hour at most,
 * counted in the database, so a stuck button cannot flood an inbox.
 *
 * Only a hash of the token is stored: the link in the email is the token.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  if (!mailConfigured()) return NextResponse.json({ sent: false, email: 'off' })

  const { data: me } = await supabase.rpc('my_email')
  const mine = me as { email?: string | null; verified?: boolean } | null
  if (!mine?.email) return NextResponse.json({ sent: false, reason: 'no email' })
  if (mine.verified) return NextResponse.json({ sent: false, verified: true })

  const admin = createAdminClient()
  const since = new Date(Date.now() - 3600e3).toISOString()
  const { count } = await admin
    .from('email_confirmations')
    .select('token_hash', { count: 'exact', head: true })
    .eq('profile_id', auth.user.id)
    .gte('created_at', since)
  if ((count ?? 0) >= 3) return NextResponse.json({ sent: false, reason: 'try again in an hour' }, { status: 429 })

  const token = randomBytes(32).toString('base64url')
  const { error } = await admin.from('email_confirmations').insert({
    token_hash: createHash('sha256').update(token).digest('hex'),
    profile_id: auth.user.id,
    email: mine.email,
  })
  if (error) return NextResponse.json({ sent: false }, { status: 500 })

  const link = `${siteUrl()}/auth/confirm-email?t=${token}`
  const [id] = await sendEach([{
    from: fromAs('Squadroom'),
    to: mine.email,
    subject: 'Confirm your email for Squadroom',
    text: `Tap to confirm this is your email:\n\n${link}\n\nThe link works for seven days. If you didn't add this address to Squadroom, ignore this email.`,
    html:
      `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#101012">` +
      `<p style="font-size:16px">Tap to confirm this is your email.</p>` +
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#101012;color:#ffffff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Confirm my email</a></p>` +
      `<p style="font-size:12px;color:#6b6b73">The link works for seven days. If you didn't add this address to Squadroom, ignore this email.</p></div>`,
  }])
  return NextResponse.json({ sent: id !== null })
}
