import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adoptEmail } from '@/lib/account-email'
import { syntheticEmail } from '@/lib/join'
import { addHat, joinTeam } from '@/lib/membership'
import { issueRefund } from '@/lib/stripe/refund'

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
  const { requestId, decision, teamId, note, number: numberRaw } = (body ?? {}) as {
    requestId?: string
    decision?: 'approve' | 'decline'
    teamId?: string | null
    note?: string
    /** 0268: the jersey number, in the same step as the squad (one pool per season, 0085). */
    number?: number | string | null
  }
  const number = numberRaw == null || numberRaw === '' ? null : Number(numberRaw)
  if (number !== null && !(Number.isInteger(number) && number >= 1 && number <= 99)) {
    return NextResponse.json({ error: 'A squad number is 1 to 99.' }, { status: 400 })
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
      'id, academy_id, program_id, status, guardian_name, guardian_phone, guardian_email, child_name, child_dob, child_gender, consents, ffa_number, fifa_id, official_confirmed_at, for_self, photo_path, register_as, wwcc_number, wwcc_expires_on, wwcc_checked_at'
    )
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'Already decided' }, { status: 409 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // 0263: a club that requires a photo does not approve without one — the
  // family adds it from the same page on their phone.
  if (decision === 'approve' && !req.photo_path) {
    const { data: club } = await admin.from('academies').select('photo_required').eq('id', req.academy_id).maybeSingle()
    if (club?.photo_required) {
      return NextResponse.json({ error: `${req.child_name} has no photo yet, and the club requires one. Ask the family to add it from their registration page, then approve.` }, { status: 422 })
    }
  }

  // 0267: a coach, team manager, volunteer or referee. A coach, a manager
  // or a referee is approved only once the club has checked the Working
  // With Children Check on the register and ticked it; a manager needs the
  // squad they manage. Refused here, before any account is made.
  const registerAs = (req.register_as ?? 'player') as 'player' | 'coach' | 'team_manager' | 'volunteer' | 'referee'
  if (decision === 'approve' && registerAs !== 'player') {
    if (registerAs !== 'volunteer' && !(req.wwcc_number && req.wwcc_expires_on && req.wwcc_checked_at)) {
      return NextResponse.json(
        { error: `${req.child_name}'s Working With Children Check has to be checked on the Service NSW register first — tick it on the request, then approve.` },
        { status: 422 }
      )
    }
    if (req.wwcc_expires_on && new Date(req.wwcc_expires_on + 'T00:00:00') <= new Date()) {
      return NextResponse.json({ error: `${req.child_name}'s Working With Children Check has expired.` }, { status: 422 })
    }
    if (registerAs === 'team_manager' && !teamId) {
      return NextResponse.json({ error: 'Pick the squad they manage, then approve.' }, { status: 422 })
    }
  }

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
        // 0263: a photo the club will not use is not kept.
        photo_path: null,
      })
      .eq('id', requestId)
    if (req.photo_path) await admin.storage.from('player-photos').remove([req.photo_path])
    // 0262: a pay-now registration that was paid is refunded in full, now,
    // without anyone tapping. The row is written first, so a Stripe that is
    // down leaves a refund the Treasurer sees as "requested", never nothing.
    const { data: paidRows } = await admin
      .from('payments')
      .select('id, amount_cents')
      .eq('registration_request_id', requestId)
      .eq('status', 'paid')
      .is('refunded_at', null)
    const refunds: { id: string; ok: boolean; error?: string }[] = []
    for (const p of paidRows ?? []) {
      const { data: row } = await admin
        .from('refunds')
        .insert({ academy_id: req.academy_id, amount_cents: p.amount_cents, payment_id: p.id, reason: 'declined', note: `Declined registration for ${req.child_name}`, status: 'requested' })
        .select('id')
        .single()
      if (!row) continue
      const issued = await issueRefund(admin, row.id, auth.user.id)
      refunds.push({ id: row.id, ok: issued.ok, error: issued.ok ? undefined : issued.error })
    }
    return NextResponse.json({ ok: true, refunds })
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

  // The email they registered with becomes the account's (0214), unless the
  // account has one already. Before 0214 this quietly does nothing.
  await adoptEmail(admin, profileId, req.guardian_email)

  // 0267: a role. No player and no program — the hat, the clearance as
  // checked, the squad where there is one, the referee's place in the pool;
  // the photo to the staff folder; the consents against the person.
  if (registerAs !== 'player') {
    // The clearance first: the coach's hat and the squad row below are
    // refused without a current one (0120).
    if (req.wwcc_number && req.wwcc_expires_on) {
      await admin.from('staff_clearances').upsert(
        {
          academy_id: req.academy_id,
          profile_id: profileId,
          kind: 'wwcc',
          number: req.wwcc_number,
          outcome: 'cleared',
          expires_on: req.wwcc_expires_on,
          verified_by: auth.user.id,
          verified_at: now,
          note: 'Given at registration; checked on the register before approval.',
        },
        { onConflict: 'academy_id,profile_id' }
      )
    }
    if (registerAs !== 'referee') {
      await addHat(admin, { academyId: req.academy_id, profileId, hat: registerAs === 'coach' ? 'coach' : 'parent', invitedBy: auth.user.id })
    }
    if (registerAs === 'coach' && teamId) {
      await joinTeam(admin, { academyId: req.academy_id, teamId, profileId, role: 'coach' })
    }
    if (registerAs === 'team_manager' && teamId) {
      const { data: has } = await admin.from('club_roles').select('id').eq('academy_id', req.academy_id).eq('profile_id', profileId).eq('role', 'team_manager').eq('team_id', teamId).maybeSingle()
      if (!has) await admin.from('club_roles').insert({ academy_id: req.academy_id, profile_id: profileId, role: 'team_manager', scope_kind: 'team', team_id: teamId, granted_by: auth.user.id })
    }
    if (registerAs === 'volunteer') {
      const { data: has } = await admin.from('club_roles').select('id').eq('academy_id', req.academy_id).eq('profile_id', profileId).eq('role', 'volunteer').maybeSingle()
      if (!has) await admin.from('club_roles').insert({ academy_id: req.academy_id, profile_id: profileId, role: 'volunteer', scope_kind: 'club', granted_by: auth.user.id })
    }
    if (registerAs === 'referee') {
      const { data: inPool } = await admin.from('referees').select('id').eq('academy_id', req.academy_id).eq('profile_id', profileId).maybeSingle()
      if (!inPool) {
        await admin.from('referees').insert({ academy_id: req.academy_id, profile_id: profileId, full_name: req.child_name, phone: req.guardian_phone, status: 'active', claimed_at: now, created_by: auth.user.id })
      }
    }
    let photoPath: string | null = req.photo_path
    if (req.photo_path) {
      const ext = req.photo_path.split('.').pop() ?? 'jpg'
      const dest = `${req.academy_id}/staff/${profileId}/registration.${ext}`
      const { error: moveErr } = await admin.storage.from('player-photos').move(req.photo_path, dest)
      if (!moveErr) photoPath = dest
    }
    const roleConsents = (req.consents ?? []) as { id: string; version: number }[]
    if (roleConsents.length > 0) {
      await admin.from('consent_acceptances').upsert(
        roleConsents.map((c) => ({ academy_id: req.academy_id, document_id: c.id, profile_id: profileId, player_id: null, accepted: true, accepted_at: now })),
        { onConflict: 'document_id,profile_id,player_id' }
      )
    }
    await admin
      .from('registration_requests')
      .update({ status: 'approved', profile_id: profileId, photo_path: photoPath, decided_by: auth.user.id, decided_at: now, decision_note: note?.trim() || null })
      .eq('id', requestId)
    return NextResponse.json({ ok: true, role: registerAs })
  }
  // A player's registration always has its program (the table says so).
  if (!req.program_id) return NextResponse.json({ error: 'This registration has no program.' }, { status: 500 })

  // 0268: the jersey number is checked against the season's pool BEFORE
  // anything is written, so a taken number is a sentence and not a
  // half-approved registration. The season is the squad's.
  let numberSeason: string | null = null
  if (teamId && number !== null) {
    const { data: squad } = await admin.from('teams').select('season').eq('id', teamId).maybeSingle()
    numberSeason = squad?.season ?? String(new Date().getFullYear())
    const { data: holder } = await admin.from('squad_numbers').select('player_id').eq('academy_id', req.academy_id).eq('season', numberSeason).eq('number', number).maybeSingle()
    if (holder) {
      const { data: same } = await admin.from('players').select('id').eq('academy_id', req.academy_id).eq('dob', req.child_dob).ilike('full_name', req.child_name).maybeSingle()
      if (!same || same.id !== holder.player_id) {
        return NextResponse.json({ error: `Number ${number} is taken this season. Pick another.` }, { status: 409 })
      }
    }
  }

  // 0239: an adult registering themselves is the player; a child's
  // registration makes a parent. Hats, not a single role (0237): someone
  // already here keeps what they are and gains this.
  const forSelf = Boolean((req as { for_self?: boolean }).for_self)
  const hat = forSelf ? 'player' : 'parent'

  // The child. Matched on NAME AND DATE OF BIRTH, which is the point of
  // collecting a date of birth: name alone matches a cousin, and two clubs
  // can easily both have a Leo. A second guardian registering the same child
  // attaches to the existing roster row rather than creating a twin.
  const { data: match } = await admin
    .from('players')
    .select('id, official_status')
    .eq('academy_id', req.academy_id)
    .eq('dob', req.child_dob)
    .ilike('full_name', req.child_name)
    .maybeSingle()

  // R-18: PlayFootball first. For a program that requires it, somebody at
  // the club has confirmed the registration on the request, or the child is
  // already on the roster as registered. The trigger on
  // program_registrations enforces the same rule below this route; the
  // check here is so the club gets a sentence, not a constraint error.
  const { data: prog } = await admin
    .from('programs')
    .select('requires_official_rego')
    .eq('id', req.program_id)
    .maybeSingle()
  const confirmed =
    Boolean(req.official_confirmed_at) ||
    match?.official_status === 'registered' ||
    match?.official_status === 'not_required'
  if (prog?.requires_official_rego && !confirmed) {
    return NextResponse.json(
      {
        error: `${req.child_name} needs their PlayFootball registration confirmed first. Tick it on the request once you have checked PlayFootball, or import your PlayFootball export.`,
      },
      { status: 409 }
    )
  }

  let playerId = match?.id ?? null

  if (!playerId) {
    const { data: newPlayer, error: playerErr } = await admin
      .from('players')
      .insert({
        academy_id: req.academy_id,
        team_id: teamId ?? null,
        full_name: req.child_name,
        dob: req.child_dob,
        profile_id: forSelf ? profileId : null,
        // Constrained on the way in (route and table), so the cast is
        // narrowing a value that is already one of the three.
        gender: req.child_gender as 'male' | 'female' | 'other' | null,
        ff_number: req.ffa_number ?? null,
        fifa_id: req.fifa_id ?? null,
        official_status: req.official_confirmed_at ? 'registered' : 'unknown',
      })
      .select('id')
      .single()
    if (playerErr || !newPlayer) {
      return NextResponse.json({ error: 'Could not add the player.' }, { status: 500 })
    }
    playerId = newPlayer.id
  } else {
    // An existing child. 0098 makes the whole family follow a child into
    // the squad's channels; and a confirmed request carries PlayFootball's
    // ids onto the roster row.
    const patch: { team_id?: string; ff_number?: string; fifa_id?: string; official_status?: 'registered'; profile_id?: string } = {}
    if (teamId) patch.team_id = teamId
    if (forSelf) patch.profile_id = profileId
    if (req.ffa_number) patch.ff_number = req.ffa_number
    if (req.fifa_id) patch.fifa_id = req.fifa_id
    if (req.official_confirmed_at && match?.official_status !== 'not_required') patch.official_status = 'registered'
    if (Object.keys(patch).length > 0) await admin.from('players').update(patch).eq('id', playerId)
  }

  // The membership after the player record, because the guards that let a
  // player's own membership through read that record (0239). Never a
  // demotion: a coach registering their own child stays the coach
  // (lib/membership.ts).
  await addHat(admin, { academyId: req.academy_id, profileId, hat, invitedBy: auth.user.id })

  if (!forSelf) {
    await admin.from('player_guardians').upsert(
      {
        academy_id: req.academy_id,
        player_id: playerId,
        profile_id: profileId,
        relationship: 'parent',
      },
      { onConflict: 'player_id,profile_id' }
    )
  }

  // 0263: the photo moves to the player's own folder, where 0146's rules
  // apply — the family, the club, the league for the season, the opposition
  // and the referee on match day.
  if (req.photo_path && playerId) {
    const ext = req.photo_path.split('.').pop() ?? 'jpg'
    const dest = `${req.academy_id}/${playerId}/registration.${ext}`
    const { error: moveErr } = await admin.storage.from('player-photos').move(req.photo_path, dest)
    if (!moveErr) await admin.from('players').update({ photo_url: dest }).eq('id', playerId)
  }

  // 0262: a payment made on submit now belongs to the player it was for and
  // moves onto the program's own fee, so it reads as paid everywhere a
  // family's or the club's money is read; the registration's stand-in fee
  // is closed.
  const { data: paidProgram } = await admin.from('programs').select('payment_request_id').eq('id', req.program_id).maybeSingle()
  const { data: guestPays } = await admin.from('payments').select('id, request_id').eq('registration_request_id', requestId).is('player_id', null)
  for (const gp of guestPays ?? []) {
    const patch: { player_id: string; profile_id: string; request_id?: string } = { player_id: playerId, profile_id: profileId }
    if (paidProgram?.payment_request_id) patch.request_id = paidProgram.payment_request_id
    const { error: moveErr } = await admin.from('payments').update(patch).eq('id', gp.id)
    if (!moveErr && paidProgram?.payment_request_id && gp.request_id !== paidProgram.payment_request_id) {
      await admin.from('payment_requests').update({ archived_at: now }).eq('id', gp.request_id)
    }
  }
  // 0264: an Active & Creative Kids voucher put on the registration before
  // the club decided moves the same way, onto the program's fee and the
  // child, so what is owed reads right and the Treasurer's list names them.
  if (paidProgram?.payment_request_id) {
    const { data: held } = await admin.from('vouchers').select('id').eq('registration_request_id', requestId).not('voucher_number', 'is', null)
    for (const v of held ?? []) {
      await admin.from('voucher_redemptions').update({ request_id: paidProgram.payment_request_id, player_id: playerId, profile_id: profileId }).eq('voucher_id', v.id)
    }
  }

  if (teamId) {
    await joinTeam(admin, { academyId: req.academy_id, teamId, profileId, role: hat })
  }

  // 0268: the jersey, in the same step as the squad. One number per player
  // per season, so a child already holding one this season moves to this one.
  if (teamId && number !== null && numberSeason) {
    await admin.from('squad_numbers').upsert(
      { academy_id: req.academy_id, player_id: playerId, season: numberSeason, number, assigned_by: auth.user.id },
      { onConflict: 'academy_id,season,player_id' }
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
