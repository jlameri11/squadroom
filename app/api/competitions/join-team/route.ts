import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adoptEmail } from '@/lib/account-email'
import { syntheticEmail, toE164 } from '@/lib/join'

/**
 * Team Creator (Part C item 3; 0261): a teammate joins a captain's team by
 * its code, from /c/{slug}/team/{code}. No account yet — a name, a mobile,
 * an email and a date of birth. The route finds or makes the account by
 * the mobile (as the join link does) and the database puts them on the
 * team as themselves; the first joiner whose mobile or email is the one on
 * the request is the captain. Adults only: the database refuses a child.
 */
function isPlausibleDob(s: string) {
  const d = new Date(`${s}T00:00:00`)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && d.getFullYear() > 1900 && d < new Date()
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { code, fullName, phone, email, dob } = (body ?? {}) as { code?: string; fullName?: string; phone?: string; email?: string; dob?: string }
  if (!code?.trim() || !fullName?.trim() || !phone?.trim() || !dob) {
    return NextResponse.json({ error: 'Your name, your mobile and your date of birth, please.' }, { status: 400 })
  }
  if (!isPlausibleDob(dob)) return NextResponse.json({ error: 'That date of birth does not look right.' }, { status: 400 })
  const e164 = toE164(phone)
  if (!e164) return NextResponse.json({ error: 'That mobile number does not look right.' }, { status: 400 })
  const mail = (email ?? '').trim().toLowerCase()
  if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 })

  const admin = createAdminClient()
  // Someone may already exist — a parent at a club, a player elsewhere.
  const { data: existing } = await admin.from('profiles').select('id, full_name').eq('phone', e164).maybeSingle()
  let profileId = existing?.id ?? null
  if (!profileId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: mail || syntheticEmail(e164),
      phone: e164,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: fullName.trim() },
    })
    if (createErr || !created.user) {
      return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 })
    }
    profileId = created.user.id
    await admin.from('profiles').upsert({ id: profileId, full_name: fullName.trim(), phone: e164 })
  }
  if (mail) await adoptEmail(admin, profileId, mail)

  const { data, error } = await admin.rpc('join_captain_team', { p_code: code.trim().toUpperCase(), p_profile: profileId, p_full_name: fullName.trim(), p_dob: dob })
  if (error) {
    const status = error.code === '42501' ? 403 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>), email: mail || null, newAccount: !existing })
}
