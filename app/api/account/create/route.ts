import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkEmail } from '@/lib/email'
import { toE164 } from '@/lib/join'
import { clientIpHash, issueCode, type Issued } from '@/lib/account/codes'

export const runtime = 'nodejs'

type Lookup = {
  by_email?: { user_id: string; confirmed: boolean; has_password: boolean; placeholder: boolean } | null
  by_account_email?: { profile_id: string; user_email: string | null; confirmed: boolean; has_password: boolean; placeholder: boolean; phone: string | null } | null
  by_phone?: { profile_id: string; user_email: string | null; placeholder: boolean; has_password: boolean; account_email: string | null } | null
}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/**
 * Creating an account, step one (the sign-up brief, 12 Nov 2026; 0272):
 * first, middle and last name, email, mobile. The password stays in the
 * browser until the emailed code is confirmed (/api/account/confirm), so an
 * account nobody confirmed has no password and signs nobody in — "no access
 * until confirmed" holds whatever the project's mailer settings are.
 *
 * Service role: there is no user yet. Nothing here grants access. What it
 * decides, with `account_lookup`:
 *   - the email is already a confirmed sign-in → "sign in instead";
 *   - the email is an unfinished sign-up → theirs again, a new code;
 *   - the email is the address a phone-joined parent gave their club
 *     (account_emails) → proving it claims THAT account: names, password
 *     and the real address land on it when the code is confirmed, and
 *     nothing is duplicated;
 *   - the mobile is on somebody's account → not taken over by whoever types
 *     it (a mobile is not verified yet; an email is) → "sign in instead";
 *   - otherwise a new, unconfirmed account.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const { first, middle, last, email, mobile } = body as {
    first?: string
    middle?: string
    last?: string
    email?: string
    mobile?: string
  }

  const firstName = clean(first)
  const middleName = clean(middle) || null
  const lastName = clean(last)
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'Your first and last name, please.' }, { status: 400 })
  }
  if (firstName.length > 80 || (middleName?.length ?? 0) > 80 || lastName.length > 80) {
    return NextResponse.json({ error: 'That name is too long.' }, { status: 400 })
  }
  const mail = checkEmail(email)
  if (!mail.ok) return NextResponse.json({ error: mail.error }, { status: 400 })
  // +61 unless they typed another country's code (lib/join.ts).
  const phone = typeof mobile === 'string' ? toE164(mobile) : null
  if (!phone) {
    return NextResponse.json({ error: 'A mobile number, please — 04… in Australia, or with its country code.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const ipHash = clientIpHash(request)
  const { data: found } = await admin.rpc('account_lookup', { p_email: mail.email, p_phone: phone })
  const look = (found ?? {}) as Lookup
  const meta = { full_name: `${firstName} ${lastName}`, first_name: firstName, middle_name: middleName, last_name: lastName }
  const phoneTaken = NextResponse.json(
    { error: 'phone-taken', message: 'That mobile is already on an account. Sign in instead — we can email you a code.' },
    { status: 409 }
  )

  if (look.by_email) {
    if (look.by_email.confirmed || look.by_email.has_password) {
      return NextResponse.json({ error: 'exists', message: 'This email already has an account. Sign in instead.' }, { status: 409 })
    }
    // An unfinished sign-up with this address: theirs again, with what they typed this time.
    if (look.by_phone && look.by_phone.profile_id !== look.by_email.user_id) return phoneTaken
    await admin.auth.admin.updateUserById(look.by_email.user_id, { phone, user_metadata: meta })
    await admin.from('profiles').update({ first_name: firstName, middle_name: middleName, last_name: lastName }).eq('id', look.by_email.user_id)
    return reply(await issueCode(admin, { email: mail.email, purpose: 'confirm', ipHash, userId: look.by_email.user_id, payload: { mode: 'new' } }))
  }

  if (look.by_account_email?.placeholder) {
    if (look.by_phone && look.by_phone.profile_id !== look.by_account_email.profile_id) return phoneTaken
    const issued = await issueCode(admin, {
      email: mail.email,
      purpose: 'confirm',
      ipHash,
      userId: look.by_account_email.profile_id,
      payload: { mode: 'adopt', first: firstName, middle: middleName, last: lastName, phone },
    })
    return reply(issued, { adopt: true })
  }

  if (look.by_phone) return phoneTaken

  const { data: created, error } = await admin.auth.admin.createUser({
    email: mail.email,
    phone,
    email_confirm: false,
    phone_confirm: false,
    user_metadata: meta,
  })
  if (error || !created.user) {
    return NextResponse.json({ error: 'Could not make the account. Try again in a moment.' }, { status: 500 })
  }
  return reply(await issueCode(admin, { email: mail.email, purpose: 'confirm', ipHash, userId: created.user.id, payload: { mode: 'new' } }))
}

function reply(issued: Issued, extra: Record<string, unknown> = {}) {
  if (!issued.ok) return NextResponse.json({ error: issued.error, wait: issued.wait }, { status: issued.status })
  return NextResponse.json({ ok: true, sent: true, channel: issued.channel, wait: issued.wait, demo_code: issued.demo_code, ...extra })
}
