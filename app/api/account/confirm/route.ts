import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkEmail } from '@/lib/email'
import { verifyCode, type Purpose } from '@/lib/account/codes'
import { mintSession } from '@/lib/account/session'

export const runtime = 'nodejs'

const PURPOSES: Purpose[] = ['confirm', 'sign_in', 'reset']
// The brief's one password rule: at least 8, nothing else.
const MIN_PASSWORD = 8

/**
 * The person set a password (0272): auth.users cannot say — an account made
 * without one carries a random hash — so it is recorded with the account.
 */
async function markPasswordSet(admin: ReturnType<typeof createAdminClient>, userId: string) {
  await admin.from('user_settings').upsert({ profile_id: userId, password_set_at: new Date().toISOString() }, { onConflict: 'profile_id' })
}

/** Only ever a path on this site: an open redirect after sign-in is how a phishing page borrows a domain. */
function safeNext(raw: unknown): string {
  const n = typeof raw === 'string' ? raw : '/'
  return n.startsWith('/') && !n.startsWith('//') ? n : '/'
}

/**
 * The six digits typed (the sign-up brief, 12 Nov 2026; 0272).
 *
 *   confirm  a new account: the password is set now (it never left the
 *            browser until this), the address is confirmed, the session
 *            minted — or an existing phone-joined account is adopted: this
 *            address becomes its sign-in, with the names and password typed.
 *   sign_in  an existing account, without a password.
 *   reset    a forgotten password: the new one is set, then signed in.
 *
 * A wrong or expired code is refused by `verifyCode`, five tries a code.
 * The password is checked BEFORE the code is spent, so a reload that lost
 * it costs nothing but typing it again.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { email, code, purpose, password, next } = (body ?? {}) as {
    email?: string
    code?: string
    purpose?: string
    password?: string
    next?: string
  }
  const mail = checkEmail(email)
  if (!mail.ok) return NextResponse.json({ error: mail.error }, { status: 400 })
  if (!PURPOSES.includes(purpose as Purpose) || typeof code !== 'string') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
  const want = purpose as Purpose
  const needsPassword = want === 'confirm' || want === 'reset'
  if (needsPassword && (typeof password !== 'string' || password.length < MIN_PASSWORD)) {
    return NextResponse.json({ error: 'password-needed', message: `A password of at least ${MIN_PASSWORD} characters, please.` }, { status: 400 })
  }

  const admin = createAdminClient()
  const v = await verifyCode(admin, { email: mail.email, purpose: want, code })
  if (!v.ok) {
    return NextResponse.json({ error: v.error, reason: v.reason, attempts_left: v.attempts_left }, { status: v.status })
  }
  const userId = v.row.user_id
  if (!userId) return NextResponse.json({ error: 'That code belongs to no account.' }, { status: 409 })
  const { data: u } = await admin.auth.admin.getUserById(userId)
  if (!u?.user) return NextResponse.json({ error: 'That account is gone.' }, { status: 409 })

  if (want === 'confirm') {
    const payload = (v.row.payload ?? {}) as { mode?: 'new' | 'adopt'; first?: string; middle?: string | null; last?: string; phone?: string }
    if (payload.mode === 'adopt') {
      // The phone-joined account becomes this address's. The mobile they
      // typed goes on only when it is theirs already or nobody's.
      const { error } = await admin.auth.admin.updateUserById(userId, {
        email: mail.email,
        email_confirm: true,
        password,
        user_metadata: { ...(u.user.user_metadata ?? {}), full_name: `${payload.first} ${payload.last}`, first_name: payload.first, middle_name: payload.middle ?? null, last_name: payload.last },
      })
      if (error) return NextResponse.json({ error: 'Could not finish the account. Try again.' }, { status: 500 })
      await admin.from('profiles').update({ first_name: payload.first ?? '', middle_name: payload.middle ?? null, last_name: payload.last ?? '' }).eq('id', userId)
      await admin.from('account_emails').update({ verified_at: new Date().toISOString() }).eq('profile_id', userId).eq('email', mail.email)
    } else {
      if ((u.user.email ?? '').toLowerCase() !== mail.email) {
        return NextResponse.json({ error: 'That code is for a different address.' }, { status: 409 })
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true, password })
      if (error) return NextResponse.json({ error: 'Could not finish the account. Try again.' }, { status: 500 })
    }
    await markPasswordSet(admin, userId)
    if (!(await mintSession(admin, mail.email))) {
      return NextResponse.json({ error: 'Your account is ready, but signing you in failed. Sign in with your password.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, next: safeNext(next) })
  }

  const authEmail = u.user.email
  if (!authEmail) return NextResponse.json({ error: 'That account has no sign-in address.' }, { status: 409 })

  if (want === 'reset') {
    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true })
    if (error) return NextResponse.json({ error: 'Could not set that password. Try another.' }, { status: 500 })
    await markPasswordSet(admin, userId)
  }

  if (!(await mintSession(admin, authEmail))) {
    return NextResponse.json({ error: 'Could not sign you in. Try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, next: safeNext(next) })
}
