import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkEmail } from '@/lib/email'
import { clientIpHash, issueCode, RESEND_AFTER_S, type Purpose } from '@/lib/account/codes'

export const runtime = 'nodejs'

const PURPOSES: Purpose[] = ['confirm', 'sign_in', 'reset']

/**
 * A code for an account that exists (the sign-up brief, 12 Nov 2026):
 * "Email me a code instead" (sign_in), "Forgot password" (reset), or
 * another code for a sign-up still waiting on its first (confirm).
 *
 * An address nobody holds gets the same answer and no email — this route
 * must not say which addresses are accounts. A phone-joined parent's
 * account is found by the address they gave their club (account_emails),
 * which is how they sign in by code before they have a password.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { email, purpose } = (body ?? {}) as { email?: string; purpose?: string }
  const mail = checkEmail(email)
  if (!mail.ok) return NextResponse.json({ error: mail.error }, { status: 400 })
  if (!PURPOSES.includes(purpose as Purpose)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const want = purpose as Purpose

  const admin = createAdminClient()
  const { data: found } = await admin.rpc('account_lookup', { p_email: mail.email, p_phone: '' })
  const look = (found ?? {}) as {
    by_email?: { user_id: string; confirmed: boolean; has_password: boolean } | null
    by_account_email?: { profile_id: string; confirmed: boolean; has_password: boolean; placeholder: boolean } | null
  }

  const silent = NextResponse.json({ ok: true, sent: true, channel: 'email', wait: RESEND_AFTER_S })

  if (want === 'confirm') {
    // Only an unfinished sign-up has anything to confirm.
    if (!look.by_email || look.by_email.confirmed) return silent
    return reply(await issueCode(admin, { email: mail.email, purpose: 'confirm', ipHash: clientIpHash(request), userId: look.by_email.user_id, payload: { mode: 'new' } }))
  }

  const userId = look.by_email?.user_id ?? look.by_account_email?.profile_id ?? null
  if (!userId) return silent
  if (look.by_email && !look.by_email.confirmed && !look.by_email.has_password) {
    // Started and never confirmed: there is no account to sign in to yet.
    return NextResponse.json({ error: 'unconfirmed', message: 'That account was never finished. Create it again and we’ll send the code.' }, { status: 409 })
  }
  return reply(await issueCode(admin, { email: mail.email, purpose: want, ipHash: clientIpHash(request), userId }))
}

function reply(issued: Awaited<ReturnType<typeof issueCode>>) {
  if (!issued.ok) return NextResponse.json({ error: issued.error, wait: issued.wait }, { status: issued.status })
  return NextResponse.json({ ok: true, sent: true, channel: issued.channel, wait: issued.wait, demo_code: issued.demo_code })
}
