import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mailConfigured } from '@/lib/mail/resend'
import { chooseDestination, hashCode, makeCode, sendCodeEmail, smsConfigured, startSmsVerification } from '@/lib/two-step/deliver'

export const runtime = 'nodejs'

const CODE_LIFE_MS = 10 * 60_000
const RESEND_AFTER_MS = 60_000
const SENDS_AN_HOUR = 5

/**
 * Send the signed-in person their six-digit code (0232; Joey, 9 Nov 2026).
 *
 * By text to the mobile on their account (Twilio Verify, which makes and
 * holds the code), by email when there is no mobile (a code we make and keep
 * hashed), or — for a demo or placeholder account, which can receive
 * neither — on the screen itself, in the response. The server is the only
 * thing that can start a text (it costs money), so the rate is held here:
 * one send a minute, five an hour.
 *
 * Who is asking comes from the session cookie, verified locally
 * (getClaims); the row is written with the service role because the codes
 * table has no policies at all — a browser must never read a code.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const sub = claims?.claims?.sub
  if (!sub) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const admin = createAdminClient()
  const [{ data: user }, { data: profile }, { data: account }, { data: existing }] = await Promise.all([
    admin.auth.admin.getUserById(sub),
    admin.from('profiles').select('phone').eq('id', sub).maybeSingle(),
    admin.from('account_emails').select('email').eq('profile_id', sub).maybeSingle(),
    admin.from('two_step_codes').select('*').eq('profile_id', sub).maybeSingle(),
  ])

  const now = Date.now()
  // A code already on its way: say so, send nothing. A browser that reloads
  // (or React mounting twice in development) must not cost a second text.
  // A demo account's code is shown again (0233): it was never sent anywhere.
  if (existing && new Date(existing.expires_at).getTime() > now && now - new Date(existing.created_at).getTime() < RESEND_AFTER_MS) {
    return NextResponse.json({
      sent: true,
      resent: false,
      channel: existing.channel,
      to: existing.sent_to,
      wait: Math.ceil((RESEND_AFTER_MS - (now - new Date(existing.created_at).getTime())) / 1000),
      dev_code: existing.channel === 'demo' ? (existing.demo_code ?? undefined) : undefined,
    })
  }
  let sends = 1
  let windowStartedAt = new Date(now).toISOString()
  if (existing && now - new Date(existing.window_started_at).getTime() < 3_600_000) {
    sends = existing.sends + 1
    windowStartedAt = existing.window_started_at
    if (sends > SENDS_AN_HOUR) {
      const wait = Math.ceil((3_600_000 - (now - new Date(existing.window_started_at).getTime())) / 60_000)
      return NextResponse.json({ error: 'too-many', wait }, { status: 429 })
    }
  }

  const dest = chooseDestination({
    signInEmail: user?.user?.email ?? null,
    authPhone: user?.user?.phone ?? null,
    profilePhone: (profile?.phone as string | null | undefined) ?? null,
    accountEmail: account?.email ?? null,
  })
  if (!dest) return NextResponse.json({ error: 'no-destination' }, { status: 409 })

  let channel: 'sms' | 'email' | 'demo'
  let destination: string
  let codeHash: string | null = null
  let salt: string | null = null
  let devCode: string | undefined

  if (dest.demo) {
    // A demo account (docs/DEMO.md) or a placeholder sign-in cannot receive
    // a text or an email. Its code is shown on the screen: two-step is a
    // demonstration there, never a lock — and never for a real account.
    channel = 'demo'
    destination = dest.phone ?? dest.email ?? 'demo'
    const code = makeCode()
    ;({ hash: codeHash, salt } = hashCode(code))
    devCode = code
  } else if (dest.phone && smsConfigured()) {
    const started = await startSmsVerification(dest.phone)
    if (!started) {
      if (dest.email && mailConfigured()) {
        channel = 'email'
        destination = dest.email
        const code = makeCode()
        ;({ hash: codeHash, salt } = hashCode(code))
        const sent = await sendCodeEmail(dest.email, code)
        if (!sent) return NextResponse.json({ error: 'email-failed' }, { status: 502 })
      } else {
        return NextResponse.json({ error: 'sms-failed' }, { status: 502 })
      }
    } else {
      channel = 'sms'
      destination = dest.phone
    }
  } else if (dest.email && mailConfigured()) {
    channel = 'email'
    destination = dest.email
    const code = makeCode()
    ;({ hash: codeHash, salt } = hashCode(code))
    const sent = await sendCodeEmail(dest.email, code)
    if (!sent) return NextResponse.json({ error: 'email-failed' }, { status: 502 })
  } else {
    // No way to reach them: no Twilio for the mobile, or no mail key for
    // the email. The wall offers an authenticator app instead.
    return NextResponse.json({ error: 'no-delivery', reason: dest.phone ? 'sms-unavailable' : 'email-unavailable' }, { status: 409 })
  }

  const to = channel === 'sms' ? dest.maskedPhone! : channel === 'email' ? dest.maskedEmail! : dest.maskedPhone ?? dest.maskedEmail ?? 'this account'
  const { error } = await admin.from('two_step_codes').upsert(
    {
      profile_id: sub,
      channel,
      sent_to: to,
      destination,
      code_hash: codeHash,
      salt,
      demo_code: channel === 'demo' ? (devCode ?? null) : null,
      expires_at: new Date(now + CODE_LIFE_MS).toISOString(),
      attempts: 0,
      sends,
      window_started_at: windowStartedAt,
      created_at: new Date(now).toISOString(),
    },
    { onConflict: 'profile_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ sent: true, resent: Boolean(existing), channel, to, wait: RESEND_AFTER_MS / 1000, dev_code: devCode })
}
