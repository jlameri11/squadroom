import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syntheticEmail } from '@/lib/join'

/**
 * A club decides on a family it has never met.
 *
 * Two clients on purpose, the same as the join approval. The user's own
 * client answers "may this person decide this?" — RLS on
 * registration_requests already encodes that only an academy's own coaches
 * see its registrations, so a successful read IS the authorisation check.
 * Only then does the admin client do the work that needs privilege.
 *
 * This is where a stranger becomes a family: an account, a roster row, a
 * guardian link, a program registration and the consents they agreed to, all
 * of which have to happen together or not at all. There is no transaction
 * across these calls — so the order matters, and it runs from the least
 * recoverable to the most. A duplicate player a coach can merge; an account
 * created for a family who was then declined is a stranger with a login.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, decision, teamId, note } = (body ?? {}) as {
    requestId?: string
    decision?: 'approve' | 'decline'
    teamId?: string | null
    note?: string
  }

  if (!requestId || (decision !== 'approve' && decision !== 'decline')) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // If RLS hides the row, this person has no business deciding it.
  const { data: req } = await supabase
    .from('registration_requests')
    .select(
      'id, academy_id, program_id, status, guardian_name, guardian_phone, guardian_email, child_name, child_dob, child_gender, consents'
    )
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (decision === 'decline') {
    // Declining creates nothing. A family who was turned away must not be
    // left with an account at a club that said no.
    await admin
      .from('registration_requests')
      .update({
        status: 'declined',
        decided_by: auth.user.id,
        decided_at: now,
        decision_note: note?.trim() || null,
      })
      .eq('id', requestId)
    return NextResponse.json({ ok: true })
  }

  if (!req.guardian_phone) {
    // An account is keyed on a phone number (see lib/join: Supabase Auth is
    // email-shaped and our parents have phone numbers). A registration with
    // only an email can be accepted into the program, but the club has to
    // collect a number before the family can sign in.
    return NextResponse.json(
      {
        error:
          'This family gave no mobile number, so an account cannot be created. Ring them for one, then approve.',
      },
      { status: 422 }
    )
  }

  // A parent with a child already here, or a coach at a second academy.
  // Reuse them rather than creating a duplicate.
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('phone', req.guardian_phone)
    .maybeSingle()

  let profileId = existing?.id ?? null

  if (!profileId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail(req.guardian_phone),
      phone: req.guardian_phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: req.guardian_name },
    })
    if (createErr || !created.user) {
      return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 })
    }
    profileId = created.user.id
  }

  // academy_members fires the trigger that puts them in the academy-wide
  // channel; team_members fires the ones for the team and age-group channels.
  await admin.from('academy_members').upsert(
    {
      academy_id: req.academy_id,
      profile_id: profileId,
      role: 'parent',
      status: 'active',
      invited_by: auth.user.id,
    },
    { onConflict: 'academy_id,profile_id' }
  )

  // The child. Matched on NAME AND DATE OF BIRTH, which is the point of
  // collecting a date of birth: name alone matches a cousin, and two clubs
  // can easily both have a Leo. A second guardian registering the same child
  // attaches to the existing roster row rather than creating a twin.
  const { data: match } = await admin
    .from('players')
    .select('id')
    .eq('academy_id', req.academy_id)
    .eq('dob', req.child_dob)
    .ilike('full_name', req.child_name)
    .maybeSingle()

  let playerId = match?.id ?? null

  if (!playerId) {
    const { data: newPlayer, error: playerErr } = await admin
      .from('players')
      .insert({
        academy_id: req.academy_id,
        team_id: teamId ?? null,
        full_name: req.child_name,
        dob: req.child_dob,
        // Constrained on the way in (route and table), so the cast is
        // narrowing a value that is already one of the three.
        gender: req.child_gender as 'male' | 'female' | 'other' | null,
      })
      .select('id')
      .single()
    if (playerErr || !newPlayer) {
      return NextResponse.json({ error: 'Could not add the player.' }, { status: 500 })
    }
    playerId = newPlayer.id
  } else if (teamId) {
    // An existing child being accepted into a squad. 0098 makes the whole
    // family follow a child into the squad's channels.
    await admin.from('players').update({ team_id: teamId }).eq('id', playerId)
  }

  await admin.from('player_guardians').upsert(
    {
      academy_id: req.academy_id,
      player_id: playerId,
      profile_id: profileId,
      relationship: 'parent',
    },
    { onConflict: 'player_id,profile_id' }
  )

  if (teamId) {
    await admin.from('team_members').upsert(
      { academy_id: req.academy_id, team_id: teamId, profile_id: profileId, role: 'parent' },
      { onConflict: 'team_id,profile_id' }
    )
  }

  // The registration itself, so the program's roll and its capacity count
  // this child from here on rather than counting the pending request.
  const { data: registration } = await admin
    .from('program_registrations')
    .upsert(
      {
        academy_id: req.academy_id,
        program_id: req.program_id,
        player_id: playerId,
        submitted_by: profileId,
        status: 'approved',
        decided_by: auth.user.id,
        decided_at: now,
      },
      { onConflict: 'program_id,player_id' }
    )
    .select('id')
    .maybeSingle()

  // The consents, recorded against the DOCUMENT VERSION they agreed to.
  // "They accepted the code of conduct" is worthless without which one.
  const consents = (req.consents ?? []) as { id: string; version: number }[]
  if (consents.length > 0) {
    await admin.from('consent_acceptances').upsert(
      consents.map((c) => ({
        academy_id: req.academy_id,
        document_id: c.id,
        profile_id: profileId,
        player_id: playerId,
        // Recorded as an acceptance, not merely as a row. The column exists
        // so a withdrawal is a different fact from never having answered.
        accepted: true,
        accepted_at: now,
      })),
      // The table's own key — NULLS NOT DISTINCT on (document_id, profile_id,
      // player_id), so re-approving the same family does not stack duplicate
      // acceptances of the same document.
      { onConflict: 'document_id,profile_id,player_id' }
    )
  }

  await admin
    .from('registration_requests')
    .update({
      status: 'approved',
      profile_id: profileId,
      player_id: playerId,
      registration_id: registration?.id ?? null,
      decided_by: auth.user.id,
      decided_at: now,
      decision_note: note?.trim() || null,
    })
    .eq('id', requestId)

  return NextResponse.json({ ok: true })
}
