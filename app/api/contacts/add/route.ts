import { NextResponse } from 'next/server'
import { createClient, getUserId } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syntheticEmail, toE164 } from '@/lib/join'

/**
 * A coach adding somebody to the club by hand.
 *
 * For the parent who turns up at training with no smartphone, the grandparent
 * who does the Saturday driving, the second coach who will never open a join
 * link. Until now the only way in was a join code, which assumes the person
 * has a phone and the patience to use it.
 *
 * PRESENCE WITHOUT ACCESS, and this is the important part.
 *
 * The person is created and appears in the directory immediately, so the club
 * can ring them. They get NO session and NO password, and their address is
 * the synthetic `@squadroom.invalid` one derived from their number, which by
 * RFC 2606 can never receive anything. So nothing here hands out access: to
 * actually sign in they still have to come through a join code and be
 * approved, which is the identity gate the whole product rests on.
 *
 * That split is deliberate. A coach vouching for somebody is good enough to
 * put them in a directory; it is not good enough to put a live session on an
 * unknown device, and CLAUDE.md is explicit that nothing may post messages
 * before approval binds a token to an identity.
 *
 * The service role is needed because creating an auth user is privileged.
 * This is the same sanctioned exception as /api/join/approve, and it checks
 * the CALLER's rights through their own session first.
 */
export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { academyId, fullName, phone, role, teamId } = (body ?? {}) as {
    academyId?: string
    fullName?: string
    phone?: string
    role?: 'parent' | 'coach' | 'admin'
    teamId?: string
  }

  if (!academyId || !fullName?.trim()) {
    return NextResponse.json({ error: 'A name is required.' }, { status: 400 })
  }

  // Checked through the CALLER's session, so RLS decides. The service role
  // below must never be the thing that answers "may this person do this".
  const supabase = await createClient()
  const { data: membership } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academyId)
    .eq('profile_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  const isCoach = ['owner', 'admin', 'coach'].includes(membership?.role ?? '')
  if (!isCoach) {
    return NextResponse.json({ error: 'Only coaches can add people.' }, { status: 403 })
  }

  // A coach may add a parent. Only an owner or admin may add staff, because
  // adding a coach grants the rights to add more coaches.
  const wanted = role ?? 'parent'
  const isStaff = ['owner', 'admin'].includes(membership?.role ?? '')
  if (wanted !== 'parent' && !isStaff) {
    return NextResponse.json(
      { error: 'Only club admins can add coaches.' },
      { status: 403 }
    )
  }

  const e164 = phone?.trim() ? toE164(phone) : null
  if (phone?.trim() && !e164) {
    return NextResponse.json(
      { error: "That doesn't look like an Australian mobile number." },
      { status: 400 }
    )
  }
  if (!e164) {
    // Without a number there is nothing to identify them by and no way to
    // reach them, which makes the row a note rather than a contact. Said
    // plainly rather than creating an account nobody can ever use.
    return NextResponse.json(
      { error: 'A mobile number is needed — it is how the club reaches them and how they join later.' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Somebody may already exist: a parent with a child in two squads, or a
  // coach at a second academy. Reuse them rather than creating a duplicate,
  // exactly as /api/join/approve does.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('phone', e164)
    .maybeSingle()

  let profileId = existing?.id ?? null
  const reused = Boolean(existing)

  if (!profileId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: syntheticEmail(e164),
      phone: e164,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: fullName.trim() },
    })
    if (createError || !created.user) {
      return NextResponse.json({ error: 'Could not create that contact.' }, { status: 500 })
    }
    profileId = created.user.id
  }

  // The name they were given here wins only if there is not one already —
  // somebody who has signed in and set their own name should not be renamed
  // by a coach typing it differently.
  if (!existing?.full_name) {
    await admin.from('profiles').update({ full_name: fullName.trim() }).eq('id', profileId)
  }

  const { error: memberError } = await admin.from('academy_members').upsert(
    { academy_id: academyId, profile_id: profileId, role: wanted, status: 'active' },
    { onConflict: 'academy_id,profile_id' }
  )
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 })
  }

  // A team puts them in that squad's conversations, through the same trigger
  // everything else uses.
  if (teamId) {
    const { error: teamError } = await admin.from('team_members').upsert(
      { academy_id: academyId, team_id: teamId, profile_id: profileId, role: wanted },
      { onConflict: 'team_id,profile_id' }
    )
    if (teamError) {
      return NextResponse.json(
        { error: `Added to the club, but not to the squad: ${teamError.message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    profileId,
    reused,
    // So the screen can say "already in the club, added to the U10s" rather
    // than implying it created somebody.
    name: existing?.full_name ?? fullName.trim(),
  })
}
