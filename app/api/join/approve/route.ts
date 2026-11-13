import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adoptEmail } from '@/lib/account-email'
import { syntheticEmail } from '@/lib/join'
import { addHat, joinTeam } from '@/lib/membership'
import type { Database } from '@/lib/database.types'

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
    .select('id, academy_id, team_id, full_name, phone, children_names, status, dob, join_link_id, profile_id')
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

  // Since the sign-up brief (12 Nov 2026) a request is made signed in and
  // carries its person from the start: nothing to find, nothing to create.
  let profileId: string | null = req.profile_id ?? null

  if (!profileId && !req.phone) {
    return NextResponse.json(
      { error: 'This request has no phone number, so an account cannot be created.' },
      { status: 422 }
    )
  }

  // An older request: someone may already exist — a parent with a child in
  // two teams, or a coach at a second academy. Reuse them rather than
  // creating a duplicate.
  if (!profileId && req.phone) {
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('phone', req.phone)
      .maybeSingle()
    profileId = existing?.id ?? null
  }

  if (!profileId && req.phone) {
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
  if (!profileId) {
    return NextResponse.json({ error: 'Could not find or create the account.' }, { status: 500 })
  }

  // 0239: a players' link (an adult team) — the person joins as themselves.
  // Their own player record comes first, because the guards that let a
  // player's membership and squad place through read it.
  const { data: link } = req.join_link_id
    ? await admin.from('join_links').select('role').eq('id', req.join_link_id).maybeSingle()
    : { data: null }
  const asPlayer = link?.role === 'player' && Boolean(req.dob)

  // Hats, not a single role (0237): someone already here as a coach or a
  // parent keeps that and gains this hat (addHat, below).
  const hat = asPlayer ? 'player' : 'parent'

  if (asPlayer) {
    const { data: ownPlayer, error: ownErr } = await admin
      .from('players')
      .insert({ academy_id: req.academy_id, team_id: req.team_id ?? null, full_name: req.full_name, dob: req.dob, profile_id: profileId })
      .select('id')
      .single()
    if (ownErr || !ownPlayer) {
      return NextResponse.json({ error: `Could not add the player: ${ownErr?.message ?? 'no row'}` }, { status: 500 })
    }
  }

  // academy_members fires the trigger that puts them in the academy-wide
  // channel; team_members fires the one that puts them in the team channel
  // and the age-group channel. Membership cascades from these two rows.
  //
  // Never a demotion (Joey, 11 Nov 2026): someone already here keeps every
  // hat and gains this one, and keeps their place on the squad if it is
  // higher (lib/membership.ts says why).
  await addHat(admin, { academyId: req.academy_id, profileId, hat, invitedBy: auth.user.id })
  if (req.team_id) {
    await joinTeam(admin, { academyId: req.academy_id, teamId: req.team_id, profileId, role: hat })
  }

  // The rest of the request, read with `*`: the email and news opt-in
  // (0214) and the children with birthdays (0248) arrive with their
  // migrations, and naming a column before its migration fails the read.
  const { data: given } = await admin.from('join_requests').select('*').eq('id', requestId).maybeSingle()
  const extra = (given ?? {}) as {
    email?: string | null
    news_opt_in_at?: string | null
    children?: { name?: string; dob?: string | null }[] | null
    wanted_role?: Database['public']['Enums']['role_request_kind'] | null
    wanted_note?: string | null
    wanted_team_ids?: string[] | null
  }

  // Children (0248): each by name and date of birth. The roster first — a
  // child already imported with this name and birthday, anywhere in the
  // club (the same name and birthday in one club is the same child), the
  // link's squad preferred; a child on no squad yet is put on the link's.
  // Only a child nobody has is created. Without a birthday (an older
  // client) the old rule holds: a name within the team, else a new record —
  // matching a bare name across the whole club would be reckless, two
  // squads can both have a Leo. A duplicate is a far smaller problem than
  // silently attaching a parent to someone else's child.
  const teamId = req.team_id
  const kids: { name: string; dob: string | null }[] =
    Array.isArray(extra.children) && extra.children.length > 0
      ? extra.children.map((k) => ({ name: (k?.name ?? '').trim(), dob: k?.dob ?? null })).filter((k) => k.name)
      : (req.children_names ?? []).map((n) => ({ name: n, dob: null }))
  for (const kid of asPlayer ? [] : kids) {
    let playerId: string | null = null

    if (kid.dob) {
      const { data: found } = await admin
        .from('players')
        .select('id, team_id')
        .eq('academy_id', req.academy_id)
        .eq('dob', kid.dob)
        .ilike('full_name', kid.name)
        .is('profile_id', null)
      const pick = (found ?? []).find((p) => p.team_id === teamId) ?? ((found ?? []).length === 1 ? found![0] : null)
      if (pick) {
        playerId = pick.id
        if (teamId && !pick.team_id) await admin.from('players').update({ team_id: teamId }).eq('id', pick.id)
      }
    } else if (teamId) {
      const { data: player } = await admin
        .from('players')
        .select('id')
        .eq('academy_id', req.academy_id)
        .eq('team_id', teamId)
        .ilike('full_name', kid.name)
        .maybeSingle()
      playerId = player?.id ?? null
    }

    if (!playerId) {
      const { data: newPlayer } = await admin
        .from('players')
        .insert({ academy_id: req.academy_id, team_id: teamId, full_name: kid.name, dob: kid.dob })
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

  // The email they gave when joining, and their news opt-in if they ticked
  // it, become the account's (0214).
  await adoptEmail(admin, profileId, extra.email, extra.news_opt_in_at ?? null)

  await admin
    .from('join_requests')
    .update({
      status: 'approved',
      profile_id: profileId,
      decided_by: auth.user.id,
      decided_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  // 0256: the role they asked for on the form becomes a request for the
  // committee — pending, opening nothing, logged and told of by its trigger.
  if (extra.wanted_role) {
    const squadRole = ['coach', 'team_manager', 'volunteer'].includes(extra.wanted_role)
    await admin.from('role_requests').insert({
      academy_id: req.academy_id,
      profile_id: profileId,
      kind: extra.wanted_role,
      team_ids: squadRole ? (extra.wanted_team_ids?.length ? extra.wanted_team_ids : req.team_id ? [req.team_id] : []) : [],
      note: extra.wanted_note ?? null,
    })
  }

  return NextResponse.json({ ok: true })
}
