import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { siteUrl } from '@/lib/site'

/**
 * Squadroom sends its own sign-in email.
 *
 * Supabase's built-in mail server allows a couple of messages an hour across
 * the entire project. That is deliberate on their part — it exists so a new
 * project works at all, not so a product runs on it — but the effect here was
 * that two coaches signing in on a Saturday morning locked each other out,
 * and the error told them to "wait a minute" with no idea why.
 *
 * So the link is minted here with the admin API and posted through a real
 * provider. Three things that follow from that, all improvements in their own
 * right:
 *
 *   * The email comes from Squadroom rather than a Supabase address, which
 *     matters when you are asking a coach to trust a login link.
 *   * The link points straight at our own callback with a token_hash, so it
 *     never touches the project Site URL or the implicit-flow fragment.
 *   * The limit is ours to set, and it is per person rather than per project.
 *
 * Without a provider key this returns 503 and the sign-in page falls back to
 * Supabase's own email, so a deployment with no mail configured still works —
 * slowly.
 */

const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_WINDOW = 4

// Per-instance and therefore imperfect, which is fine: this is a courtesy
// limit to stop somebody hammering the button, not a security control. The
// real protection is that a link is useless without the inbox it went to.
const recent = new Map<string, number[]>()

function tooMany(email: string): boolean {
  const now = Date.now()
  const hits = (recent.get(email) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  recent.set(email, hits)
  return hits.length > MAX_PER_WINDOW
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const raw = (body as { email?: string } | null)?.email
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  if (tooMany(email)) {
    return NextResponse.json(
      { error: 'A few links are already on their way. Check your inbox, including spam.' },
      { status: 429 }
    )
  }

  const admin = createAdminClient()

  // generateLink signs up unknown addresses, which would let a stranger
  // create an account by typing one in. Staff are added by an existing
  // owner, never by this form.
  const { data: users } = await admin.auth.admin.listUsers()
  const known = users.users.some((u) => u.email?.toLowerCase() === email)

  // The same answer either way. Telling an anonymous caller which addresses
  // have accounts is a way to enumerate a club's staff.
  if (!known) {
    return NextResponse.json({ ok: true })
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data?.properties?.hashed_token) {
    console.error('could not mint a sign-in link', error?.message)
    return NextResponse.json({ error: 'Could not send the link just now.' }, { status: 500 })
  }

  const link =
    `${siteUrl()}/auth/callback?type=magiclink&next=%2F&token_hash=${data.properties.hashed_token}`

  const from = process.env.MAIL_FROM ?? 'Squadroom <onboarding@resend.dev>'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Your Squadroom sign-in link',
      // Plain and short. A sign-in email that looks like marketing is one
      // people hesitate over, and hesitating over a login link is correct
      // behaviour we should not be training out of them.
      text: [
        'Tap this link to sign in to Squadroom:',
        '',
        link,
        '',
        'It works once and expires shortly. If you did not ask for it, ignore this email — nothing will happen.',
      ].join('\n'),
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1726">
          <p style="font-size:16px;margin:0 0 20px">Tap the button to sign in to Squadroom.</p>
          <p style="margin:0 0 24px">
            <a href="${link}" style="display:inline-block;background:#202842;color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600">Sign in to Squadroom</a>
          </p>
          <p style="font-size:13px;color:#4C5A6D;margin:0 0 8px">It works once and expires shortly.</p>
          <p style="font-size:13px;color:#8391A3;margin:0">If you didn't ask for this, ignore it — nothing will happen.</p>
        </div>`,
    }),
  })

  if (!response.ok) {
    console.error('mail provider refused', response.status, (await response.text()).slice(0, 300))
    return NextResponse.json({ error: 'Could not send the link just now.' }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
