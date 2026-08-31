import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syntheticEmail } from '@/lib/join'

/**
 * The coach vouches for a family.
 *
 * Two clients on purpose. The user's own client answers "may this person
 * decide this request?" — RLS on join_requests already encodes that a coach
 * sees only their own teams, so a successful read IS the authorisation check.
 * Only then does the admin client do the work that needs privilege.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const { requestId, decision } = (body ?? {}) as {
    requestId?: string
    decision?: 'approve' | 'decline'
  }

  if (!requestId || (decision !== 'approve' && decision !== 'decline')) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // If RLS hides the row, this coach has no business deciding it.
  const { data: req } = await supabase
    .from('join_requests')
    .select('id, academy_id, team_id, full_name, phone, children_names, status')
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 })
  }

  const admin = createAdminClient()

  if (decision === 'decline') {
    await admin
      .from('join_requests')
      .update({ status: 'declined', decided_by: auth.user.id, decided_at: new Date().toISOString() })
      .eq('id', requestId)
    return NextResponse.json({ ok: true })
  }

  if (!req.phone) {
    return NextResponse.json(
      { error: 'This request has no phone number, so an account cannot be created.' },
      { status: 422 }
    )
  }

  // Someone may already exist — a parent with a child in two teams, or a
  // coach at a second academy. Reuse them rather than creating a duplicate.
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('phone', req.phone)
    .maybeSingle()

  let profileId = existing?.id ?? null

  if (!profileId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail(req.phone),
      phone: req.phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { full_name: req.full_name },
    })
    if (createErr || !created.user) {
      return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 })
    }
    profileId = created.user.id
  }

  // academy_members fires the trigger that puts them in the academy-wide
  // channel; team_members fires the one that puts them in the team channel
  // and the age-group channel. Membership cascades from these two rows.
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

  if (req.team_id) {
    await admin.from('team_members').upsert(
      { academy_id: req.academy_id, team_id: req.team_id, profile_id: profileId, role: 'parent' },
      { onConflict: 'team_id,profile_id' }
    )
  }

  // Children: link to a player already on the roster where the name matches,
  // otherwise create one. Exact-name matching is crude and will mis-fire on
  // "Leo" vs "Leo Whitfield" — the coach can fix it on the roster screen, and
  // a duplicate player is a far smaller problem than silently attaching a
  // parent to someone else's child.
  for (const childName of req.children_names ?? []) {
    const { data: player } = await admin
      .from('players')
      .select('id')
      .eq('academy_id', req.academy_id)
      .eq('team_id', req.team_id)
      .ilike('full_name', childName)
      .maybeSingle()

    let playerId = player?.id ?? null

    if (!playerId) {
      const { data: newPlayer } = await admin
        .from('players')
        .insert({ academy_id: req.academy_id, team_id: req.team_id, full_name: childName })
        .select('id')
        .single()
      playerId = newPlayer?.id ?? null
    }

    if (playerId) {
      await admin.from('player_guardians').upsert(
        { academy_id: req.academy_id, player_id: playerId, profile_id: profileId, relationship: 'parent' },
        { onConflict: 'player_id,profile_id' }
      )
    }
  }

  await admin
    .from('join_requests')
    .update({
      status: 'approved',
      profile_id: profileId,
      decided_by: auth.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  return NextResponse.json({ ok: true })
}
