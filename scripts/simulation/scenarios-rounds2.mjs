// Rounds 8–14, the finals and the close (see scenarios-rounds.mjs for 1–7).
import { check, clock, ids, mustRefuse, mustWork, note, rpc, run, scenario, sql, val, who, asAnon } from './lib.mjs'
import { COMP, LEAGUE, enterScores, eventFor, game, gamesOn, guardianOf, ladder, noticesChannel, playerName, queued, refereeOf, rsvp, say, squad, submitSheet } from './world.mjs'
import { plusDays } from './routine.mjs'
import { runScreens } from './screens.mjs'

const since = (minutes = 1) => new Date(clock.now.getTime() - minutes * 60_000).toISOString()

async function pick(ctx, date, division, n = 1, offset = 0) {
  const games = (await gamesOn(ctx.pool, date, { division, status: 'scheduled' })).filter((g) => g.home_team && g.away_team)
  return games.slice(offset, offset + n)
}

// =================================================================== round 8
export async function round8(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -1)} 13:30`, 'OF2 the third game played up is over the cap', async () => {
    const d = ctx.discipline
    if (!d?.junior) return
    const u15 = (await gamesOn(pool, S, { division: 'U15 Division 1', status: 'scheduled' })).find((g) => g.home_club === d.juniorClub || g.away_club === d.juniorClub)
    if (!u15) return
    const side = u15.home_club === d.juniorClub ? 'home' : 'away'
    const priorUps = await val(pool, `select count(distinct s.fixture_id)::int from public.match_sheet_players sp join public.match_sheets s on s.id = sp.sheet_id where s.competition_id = $1 and sp.player_id = $2 and not exists (select 1 from public.entry_squads q where q.entry_id = s.entry_id and q.player_id = $2)`, [COMP, d.junior])
    const up3 = await submitSheet(pool, u15, side, { n: 11, extra: [d.junior] })
    mustRefuse(up3, { what: `a third game played up is over the division's cap of two — refused (${priorUps} on record before this sheet)`, role: 'coach', where: 'ineligibility (borrow_cap)' })
    if (!up3.ok) check(/played up 2 times/.test(up3.error), { what: 'the refusal counts the games', expected: 'has already played up 2 times … allows 2', actual: up3.error, role: 'coach', where: 'ineligibility' })
  })
  add(`${S} 12:30`, 'OF1 the third yellow brings a suspension', async () => {
    const d = ctx.discipline
    if (!d) return
    const g = (await gamesOn(pool, S)).find((x) => x.home_entry_id === d.yellowEntry || x.away_entry_id === d.yellowEntry)
    if (!g) return
    const onSheet = await val(pool, `select count(*)::int from public.match_sheet_players sp join public.match_sheets s on s.id = sp.sheet_id where s.fixture_id = $1 and sp.player_id = $2`, [g.id, d.yellowPlayer])
    if (!onSheet) { note('the yellow-card player is not on the sheet this week'); return }
    const r = await rpc(pool, (await refereeOf(pool, g.id))?.profile_id ?? who.compManager, 'record_match_event', { p_fixture: g.id, p_entry: d.yellowEntry, p_kind: 'yellow', p_player: d.yellowPlayer, p_minute: 70, p_note: null, p_code: 'Y2' })
    mustWork(r, { what: 'the third yellow is recorded', role: 'referee', where: 'record_match_event' })
    const s = await sql(pool, `select games, served, status, reason from public.suspensions where player_id = $1 and competition_id = $2 and reason like '%yellow%'`, [d.yellowPlayer, COMP])
    check(s.length === 1 && s[0].games === 1 && s[0].status === 'active', { what: 'three yellows: a one-game suspension', expected: '1 game, active', actual: JSON.stringify(s), role: 'league', where: 'suspend_on_card' })
  })
  add(`${plusDays(S, 1)} 12:30`, 'OF1 the red-card ban is fully served', async () => {
    const d = ctx.discipline
    if (!d) return
    const s = await sql(pool, `select games, served, status from public.suspensions where player_id = $1 and competition_id = $2 and reason = 'red card'`, [d.redPlayer, COMP])
    check(s[0]?.served === 2 && s[0]?.status === 'served', { what: 'two games missed: the red-card ban is served', expected: 'served 2, served', actual: JSON.stringify(s[0]), role: 'league', where: 'serve_suspensions' })
  })
  add(`${plusDays(S, 6)} 13:00`, 'OF1 the player is back after the ban; the three-yellows player is refused', async () => {
    const d = ctx.discipline
    if (!d) return
    const games = await gamesOn(pool, plusDays(S, 7), { status: 'scheduled' })
    const back = games.find((x) => x.home_entry_id === d.redEntry || x.away_entry_id === d.redEntry)
    if (back) {
      const side = back.home_entry_id === d.redEntry ? 'home' : 'away'
      const ok1 = await submitSheet(pool, back, side, { n: 12, extra: [d.redPlayer] })
      mustWork(ok1, { what: 'with the ban served the player is accepted on the sheet again', role: 'coach', where: 'submit_match_sheet' })
    }
    const yg = games.find((x) => x.home_entry_id === d.yellowEntry || x.away_entry_id === d.yellowEntry)
    if (yg) {
      const side = yg.home_entry_id === d.yellowEntry ? 'home' : 'away'
      const no = await submitSheet(pool, yg, side, { n: 12, extra: [d.yellowPlayer] })
      mustRefuse(no, { what: 'the three-yellows player is refused by name for one game', role: 'coach', where: 'ineligibility → suspension_reason' })
      await submitSheet(pool, yg, side, { n: 12, skip: [d.yellowPlayer] })
    }
  })

  // OFF2: safeguarding.
  add(`${plusDays(S, -4)} 19:00`, 'OFF2 a teenager\'s login: invited, waiting, approved; an under-13 refused; a DM brings the parent in; a message reported', async () => {
    scenario('OFF2', 'Off-field issues', 'Safeguarding: a coach DMs a child (parent added automatically), a message reported, an under-13 sign-up refused, a 13+ waits for parent approval')
    const c = 9
    const teen = (await sql(pool, `select pl.id, pl.team_id, g.profile_id as parent from public.players pl join public.teams t on t.id = pl.team_id join public.player_guardians g on g.player_id = pl.id and g.is_primary
      where pl.academy_id = $1 and t.age_group = 'U15' and pl.dob <= (pg_catalog.sim_date() - interval '13 years')::date and not exists (select 1 from public.player_logins l where l.player_id = pl.id) order by pl.id limit 1`, [ids.club(c)]))[0]
    const little = (await sql(pool, `select pl.id, g.profile_id as parent from public.players pl join public.teams t on t.id = pl.team_id join public.player_guardians g on g.player_id = pl.id and g.is_primary where pl.academy_id = $1 and t.age_group = 'U11' order by pl.id limit 1`, [ids.club(c)]))[0]
    if (!teen || !little) { note('no teen or child to use'); return }
    const email = `teen-${teen.id.slice(0, 8)}@sim.test`
    const inv = await rpc(pool, teen.parent, 'invite_player_login', { p_player: teen.id, p_email: email })
    mustWork(inv, { what: 'a parent invites their 14-year-old to a login of their own', role: 'parent', where: 'invite_player_login' })
    const under = await rpc(pool, little.parent, 'invite_player_login', { p_player: little.id, p_email: `kid-${little.id.slice(0, 8)}@sim.test` })
    mustRefuse(under, { what: 'an under-13 cannot be given a login', role: 'parent', where: 'invite_player_login (is_thirteen)' })
    if (!under.ok) check(/Under 13s/.test(under.error), { what: 'in plain words', expected: 'Under 13s don\'t have their own login…', actual: under.error, role: 'parent', where: 'invite_player_login' })
    // The teen signs up with that email (an account with no club yet), then claims.
    const teenId = `aaaaaaaa-0000-4000-8000-${teen.id.slice(-12)}`
    await sql(pool, `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
                     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), $3, '{}', now(), now()) on conflict (id) do nothing`, [teenId, email, JSON.stringify({ full_name: await playerName(pool, teen.id), first_name: (await playerName(pool, teen.id)).split(' ')[0], last_name: (await playerName(pool, teen.id)).split(' ').slice(-1)[0] })])
    const claim = await rpc(pool, teenId, 'claim_player_login', {})
    check(claim.ok && claim.data?.status === 'waiting', { what: 'the teenager claims the invitation and waits for a parent\'s yes', expected: 'waiting', actual: claim.ok ? claim.data?.status : claim.error, role: 'player (13+)', where: 'claim_player_login' })
    const sq = await squad(pool, teen.team_id)
    const early = await say(pool, teenId, sq.channel, ids.club(c), 'hi team')
    mustRefuse(early, { what: 'while waiting, the teen cannot post in the squad chat', role: 'player (13+)', where: 'messages (not a member yet)' })
    const dec = await rpc(pool, teen.parent, 'decide_player_login', { p_player: teen.id, p_approve: true })
    mustWork(dec, { what: 'the parent approves', role: 'parent', where: 'decide_player_login' })
    const member = await val(pool, `select role::text from public.academy_members where academy_id = $1 and profile_id = $2`, [ids.club(c), teenId])
    check(member === 'player', { what: 'the teen is a player member of the club, nothing more', expected: 'player', actual: member, role: 'club', where: 'decide_player_login' })
    const post = await say(pool, teenId, sq.channel, ids.club(c), 'hi team 👋')
    mustWork(post, { what: 'now they can post in the squad chat', role: 'player (13+)', where: 'messages' })
    // The coach opens a direct chat with the teen: the guardians come too.
    const dm = await rpc(pool, sq.coach, 'open_direct_channel', { p_academy: ids.club(c), p_other: teenId })
    mustWork(dm, { what: 'the coach opens a direct chat with the teenager', role: 'coach', where: 'open_direct_channel' })
    if (dm.ok) {
      const members = await sql(pool, `select profile_id from public.channel_members where channel_id = $1`, [dm.data])
      const hasParent = members.some((m) => m.profile_id === teen.parent)
      check(hasParent && members.length >= 3, { what: 'the parent is in that chat automatically — a child is never alone with an adult', expected: 'coach, teen, parent(s)', actual: `${members.length} members, parent ${hasParent ? 'in' : 'MISSING'}`, role: 'parent', where: 'channel_members_minor_brings_guardians (0076)' })
      const line = await say(pool, sq.coach, dm.data, ids.club(c), 'Well played Saturday. Training moves to 6 on Thursday.')
      mustWork(line, { what: 'the coach writes in it', role: 'coach', where: 'messages (direct)' })
      const parentTold = await queued(pool, { profile: teen.parent, message: line.data?.[0]?.id })
      check(parentTold.length === 1, { what: 'the parent is told of the coach\'s message to their child', expected: 1, actual: parentTold.length, role: 'parent', where: 'enqueue_message_notification' })
    }
    // A parent reports a message; the Welfare officer reviews it.
    const bad = await say(pool, sq.coach, sq.channel, ids.club(c), 'Whoever left the gear bag can come and get it off me — useless.')
    const rep = await rpc(pool, teen.parent, 'report_message', { p_message: bad.data[0].id, p_reason: 'inappropriate', p_note: 'Tone towards the kids' })
    mustWork(rep, { what: 'a parent reports the coach\'s message', role: 'parent', where: 'report_message' })
    const queue = await rpc(pool, who.welfare(c), 'safeguarding_queue', { p_academy: ids.club(c), p_status: 'open' })
    check(queue.ok && (queue.data ?? []).some((q) => q.report_id === rep.data), { what: 'the Welfare officer sees it in the safeguarding queue', expected: 'listed', actual: queue.ok ? `${(queue.data ?? []).length} open` : queue.error, role: 'welfare officer', where: 'safeguarding_queue' })
    const coachLooks = await rpc(pool, sq.coach, 'safeguarding_queue', { p_academy: ids.club(c), p_status: 'open' })
    check(!coachLooks.ok || (coachLooks.data ?? []).length === 0, { what: 'the coach cannot read the queue', expected: 'nothing', actual: coachLooks.ok ? `${(coachLooks.data ?? []).length} rows` : 'refused', role: 'coach', where: 'safeguarding_queue' })
    const rev = await rpc(pool, who.welfare(c), 'review_report', { p_report: rep.data, p_status: 'actioned', p_outcome: 'Spoke to the coach; message deleted' })
    mustWork(rev, { what: 'the Welfare officer actions it', role: 'welfare officer', where: 'review_report' })
    ctx.teen = { id: teenId, player: teen.id, parent: teen.parent, club: c }
  })

  // OFF6: volunteers.
  add(`${plusDays(S, -2)} 19:00`, 'OFF6 a family cannot do its turn; another takes it; the coordinator sees the gaps', async () => {
    scenario('OFF6', 'Off-field issues', 'Volunteer roster gaps on Saturday; canteen and field-marshal swaps')
    const duty = (await sql(pool, `select d.id, d.player_id, d.title, d.team_id, e.academy_id, e.id as event_id from public.event_duties d join public.events e on e.id = d.event_id
      where (e.starts_at at time zone 'Australia/Sydney')::date = $1::date and e.cancelled_at is null order by d.title, d.id limit 1`, [S]))[0]
    if (!duty) { check(false, { what: 'a rostered duty this Saturday', expected: 'one', actual: 'none', role: 'coach', where: 'roster_team_duties', severity: 'medium' }); return }
    const fam = await guardianOf(pool, duty.player_id)
    const swap = await rpc(pool, fam, 'request_duty_swap', { p_duty: duty.id, p_note: 'Away this weekend, sorry' })
    mustWork(swap, { what: `the family on ${duty.title} asks for a swap`, role: 'parent', where: 'request_duty_swap' })
    const asked = await val(pool, `select count(*)::int from public.messages where event_id = $1 and body like '%can anyone swap%'`, [duty.event_id])
    check(asked >= 1, { what: 'the squad chat carries the ask', expected: '≥1', actual: asked, role: 'parent', where: 'request_duty_swap' })
    const gaps = await rpc(pool, who.volunteers(await clubOf(pool, duty.academy_id)), 'volunteer_gaps', { p_academy: duty.academy_id })
    check(gaps.ok && (gaps.data?.duties ?? []).some((d) => d.event_id === duty.event_id && d.swaps >= 1), { what: 'the volunteer coordinator sees the gap on Rosters', expected: 'the game listed with a swap wanted', actual: gaps.ok ? `${(gaps.data?.duties ?? []).length} games with gaps` : gaps.error, role: 'volunteer coordinator', where: 'volunteer_gaps' })
    const other = await val(pool, `select g.profile_id from public.players pl join public.player_guardians g on g.player_id = pl.id where pl.team_id = $1 and pl.id <> $2 and g.is_primary order by pl.full_name limit 1`, [duty.team_id, duty.player_id])
    const take = await rpc(pool, other, 'take_duty', { p_duty: duty.id })
    mustWork(take, { what: 'another family takes it', role: 'parent', where: 'take_duty' })
    const now = await sql(pool, `select player_id, requested_swap_at from public.event_duties where id = $1`, [duty.id])
    check(now[0]?.player_id !== duty.player_id && now[0]?.requested_swap_at === null, { what: 'the duty is theirs and the ask is cleared', expected: 'reassigned', actual: JSON.stringify(now[0]), role: 'parent', where: 'event_duties' })
    const gaps2 = await rpc(pool, who.volunteers(await clubOf(pool, duty.academy_id)), 'volunteer_gaps', { p_academy: duty.academy_id })
    check(!(gaps2.data?.duties ?? []).some((d) => d.event_id === duty.event_id && d.swaps >= 1), { what: 'and the gap is gone from Rosters', expected: 'no swap wanted', actual: `${(gaps2.data?.duties ?? []).filter((d) => d.event_id === duty.event_id).length} rows`, role: 'volunteer coordinator', where: 'volunteer_gaps' })
    ctx.dutyEvent = duty.event_id
    ctx.dutyFamily = other
  })
  add(`${plusDays(S, -1)} 19:00`, 'OFF6 the reminder the night before', async () => {
    if (!ctx.dutyEvent) return
    const rem = await queued(pool, { kind: 'helper_reminder', profile: ctx.dutyFamily, event: ctx.dutyEvent })
    check(rem.length === 1, { what: 'the family now on duty is reminded the night before, once', expected: 1, actual: rem.length, role: 'parent', where: 'queue_duty_reminders' })
  })
}

async function clubOf(pool, academyId) {
  for (let c = 1; c <= 60; c++) if (ids.club(c) === academyId) return c
  return 1
}

// =================================================================== round 9
export async function round9(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -6)} 18:10`, 'OFF7b the Easter Saturday round', async () => {
    scenario('OFF7b', 'Off-field issues', 'A public-holiday round (Easter Saturday)')
    const chan = await noticesChannel(pool)
    const n = await say(pool, who.compManager, chan, LEAGUE, 'Round 9 is on Easter Saturday as drawn. Grounds open as normal; Good Friday and Easter Monday have no games.', { audience: 'everyone', is_announcement: true })
    mustWork(n, { what: 'the league says the holiday round is on', role: 'competition manager', where: 'messages (notices)' })
    const games = await gamesOn(pool, S, { status: 'scheduled' })
    check(S === '2027-04-03' && games.length > 100, { what: 'the round falls on Easter Saturday with a full card', expected: '2027-04-03, >100 games', actual: `${S}, ${games.length} games`, role: 'league', where: 'fixtures' })
    const jobs = await rpc(pool, who.compManager, 'home_jobs', { p_academy: LEAGUE, p_persona: 'league' })
    check(/games this weekend/.test((jobs.data?.jobs ?? []).find((j) => j.id === 'draw')?.detail ?? ''), { what: 'the league\'s Home counts the weekend\'s games', expected: 'N games this weekend', actual: (jobs.data?.jobs ?? []).find((j) => j.id === 'draw')?.detail, role: 'league', where: 'home_jobs' })
  })
}

// ================================================================== round 10
export async function round10(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -5)} 09:00`, 'OFF7a after the clocks went back the families\' times agree with the draw', async () => {
    scenario('OFF7a', 'Off-field issues', 'Daylight saving: the same kick-off time on the clock after the change')
    const g = (await gamesOn(pool, S, { status: 'scheduled' })).find((x) => x.home_team)
    if (!g) return
    const ev = await eventFor(pool, g.id, g.home_club)
    const parent = await guardianOf(pool, (await squad(pool, g.home_team)).players[0])
    const up = await rpc(pool, parent, 'my_upcoming_events', { p_academy: g.home_club, p_days: 21 })
    const row = (up.data ?? []).find((e) => e.id === ev)
    const fmt = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d))
    check(row && fmt(row.starts_at) === g.local_start.slice(11, 16), { what: 'a family\'s upcoming game shows the drawn kick-off on the Sydney clock (AEST now)', expected: g.local_start.slice(11, 16), actual: row ? fmt(row.starts_at) : 'not listed', role: 'parent', where: 'my_upcoming_events' })
  })

  add(`${plusDays(S, -5)} 10:00`, 'OFF4 payments: the failed card, the missed instalment, the voucher, the Active Kids voucher, the refund, the unpaid entry fee', async () => {
    scenario('OFF4', 'Off-field issues', 'Payments: a failed card, a missed instalment, a refund on withdrawal, a voucher used, an unpaid entry fee chased')
    const m = ctx.money ?? {}
    // Club 1's levy: a family whose card failed, then paid; another who missed instalment 2.
    if (m.levy) {
      const fams = await sql(pool, `select pl.id as player, g.profile_id from public.players pl join public.player_guardians g on g.player_id = pl.id and g.is_primary where pl.academy_id = $1 order by pl.id limit 2`, [ids.club(1)])
      const [failer, misser] = fams
      await sql(pool, `insert into public.payments (academy_id, request_id, profile_id, player_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, instalment_seq, created_at)
                       values ($1, $2, $3, $4, 'cs_sim_fail_1', 'pi_sim_fail_1', 4000, 'aud', 'failed', 1, now() - interval '40 days')`, [ids.club(1), m.levy, failer.profile_id, failer.player])
      const q1 = await rpc(pool, failer.profile_id, 'quote_payment', { p_request: m.levy, p_player: failer.player })
      check(q1.ok && q1.data?.outstanding_cents === 12000 && q1.data?.schedule?.[0]?.status === 'failed', { what: 'a failed card leaves the whole levy owing and the first instalment marked failed', expected: 'outstanding 12000, seq 1 failed', actual: q1.ok ? `outstanding ${q1.data?.outstanding_cents}, seq 1 ${q1.data?.schedule?.[0]?.status}` : q1.error, role: 'parent', where: 'quote_payment' })
      const need = await rpc(pool, failer.profile_id, 'needs_you', { p_academy: ids.club(1) })
      check((need.data ?? []).some((x) => x.kind === 'fees'), { what: 'and Needs you shows the fee', expected: 'a fees row', actual: JSON.stringify((need.data ?? []).map((x) => x.kind)), role: 'parent', where: 'needs_you' })
      await sql(pool, `update public.payments set status = 'paid', paid_at = now() - interval '39 days', stripe_session_id = 'cs_sim_ok_1', stripe_payment_intent = 'pi_sim_ok_1' where request_id = $1 and player_id = $2 and instalment_seq = 1`, [m.levy, failer.player])
      const q2 = await rpc(pool, failer.profile_id, 'quote_payment', { p_request: m.levy, p_player: failer.player })
      check(q2.ok && q2.data?.outstanding_cents === 8000, { what: 'paid the next day: 8000 left over two instalments', expected: 8000, actual: q2.data?.outstanding_cents, role: 'parent', where: 'quote_payment' })
      // The misser paid instalment 1 in February and nothing since: instalment 2 was due 22 March.
      await sql(pool, `insert into public.payments (academy_id, request_id, profile_id, player_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, paid_at, instalment_seq, created_at)
                       values ($1, $2, $3, $4, 'cs_sim_ok_2', 'pi_sim_ok_2', 4000, 'aud', 'paid', timestamptz '2027-02-18 10:00+11', 1, timestamptz '2027-02-18 10:00+11')`, [ids.club(1), m.levy, misser.profile_id, misser.player])
      const chased = await queued(pool, { kind: 'fee_overdue', profile: misser.profile_id })
      const dueSoon = await queued(pool, { kind: 'fee_due', profile: misser.profile_id })
      check(chased.length + dueSoon.length > 0, { what: 'the family that missed instalment 2 (due 22 March) has been chased by the morning sweep', expected: '≥1 fee reminder', actual: `${chased.length} overdue, ${dueSoon.length} due`, role: 'parent', where: 'queue_fee_reminders' })
      const owes = await rpc(pool, who.treasurer(1), 'outstanding_fees', { p_academy: ids.club(1) })
      check((owes.data ?? []).some((o) => o.player_id === misser.player && o.outstanding_cents === 8000), { what: 'the Treasurer\'s Who owes has them at 8000', expected: '8000 outstanding', actual: JSON.stringify((owes.data ?? []).find((o) => o.player_id === misser.player) ?? null)?.slice(0, 120), role: 'treasurer', where: 'outstanding_fees' })
    }
    // Club 3's voucher.
    if (m.kit) {
      const fam = (await sql(pool, `select pl.id as player, g.profile_id from public.players pl join public.player_guardians g on g.player_id = pl.id and g.is_primary where pl.academy_id = $1 order by pl.id limit 1`, [ids.club(3)]))[0]
      const v = await rpc(pool, fam.profile_id, 'redeem_voucher', { p_code: 'SIBLING20', p_request: m.kit, p_player: fam.player })
      mustWork(v, { what: 'a family uses the club\'s 20% code on the kit fee', role: 'parent', where: 'redeem_voucher' })
      const q = await rpc(pool, fam.profile_id, 'quote_payment', { p_request: m.kit, p_player: fam.player })
      check(q.ok && q.data?.voucher_cents === 1600 && q.data?.net_cents === 6400, { what: '$16 off, $64 to pay', expected: 'voucher 1600, net 6400', actual: q.ok ? `voucher ${q.data?.voucher_cents}, net ${q.data?.net_cents}` : q.error, role: 'parent', where: 'quote_payment' })
      const twice = await rpc(pool, fam.profile_id, 'redeem_voucher', { p_code: 'SIBLING20', p_request: m.kit, p_player: fam.player })
      mustRefuse(twice, { what: 'a second code on the same fee is refused', role: 'parent', where: 'redeem_voucher' })
    }
    // Club 4: the Active & Creative Kids voucher.
    if (m.rego4) {
      const fam = (await sql(pool, `select pl.id as player, pl.full_name, pl.dob, g.profile_id from public.players pl join public.player_guardians g on g.player_id = pl.id and g.is_primary where pl.academy_id = $1 order by pl.id limit 1`, [ids.club(4)]))[0]
      const ak = await rpc(pool, fam.profile_id, 'apply_active_kids_voucher', { p_request: m.rego4, p_player: fam.player, p_number: '1234567890', p_child_name: fam.full_name, p_child_dob: fam.dob })
      mustWork(ak, { what: 'a family puts their Active & Creative Kids voucher on the registration fee', role: 'parent', where: 'apply_active_kids_voucher' })
      const q = await rpc(pool, fam.profile_id, 'quote_payment', { p_request: m.rego4, p_player: fam.player })
      check(q.ok && q.data?.voucher_cents === 5000 && q.data?.net_cents === 10000, { what: '$50 off a $150 fee', expected: 'voucher 5000, net 10000', actual: q.ok ? `voucher ${q.data?.voucher_cents}, net ${q.data?.net_cents}` : q.error, role: 'parent', where: 'quote_payment' })
      const list = await rpc(pool, who.treasurer(4), 'active_kids_to_redeem', { p_academy: ids.club(4) })
      check(list.ok && (list.data ?? []).some((r) => r.voucher_number === '1234567890' && !r.redeemed_at), { what: 'the Treasurer sees it to redeem by hand in the Service NSW portal', expected: 'listed, not yet redeemed', actual: list.ok ? `${(list.data ?? []).length} to redeem` : list.error, role: 'treasurer', where: 'active_kids_to_redeem' })
      if (list.ok && list.data?.[0]) {
        const mk = await rpc(pool, who.treasurer(4), 'mark_active_kids_redeemed', { p_voucher: list.data[0].voucher_id, p_redeemed: true })
        mustWork(mk, { what: 'and ticks it once redeemed', role: 'treasurer', where: 'mark_active_kids_redeemed' })
      }
    }
    // Club 2: the withdrawal on 6 April, after the full-refund date — half back.
    if (m.registration) {
      const w = await rpc(pool, m.registration.parent, 'withdraw_registration', { p_registration: m.registration.id, p_reason: 'Moving to Newcastle' })
      mustWork(w, { what: 'a family withdraws from the development squad', role: 'parent', where: 'withdraw_registration' })
      check(w.data?.policy === 'partial' && w.data?.refund_cents === 7500, { what: 'after 31 March the refund is half: $75', expected: 'partial, 7500', actual: JSON.stringify(w.data), role: 'parent', where: 'withdraw_registration (refund_bps_after)' })
      const todo = await rpc(pool, who.treasurer(2), 'refunds_to_issue', { p_academy: ids.club(2) })
      check(JSON.stringify(todo.data ?? '').includes('7500'), { what: 'the Treasurer has a $75 refund to issue', expected: '7500 listed', actual: JSON.stringify(todo.data ?? todo.error).slice(0, 120), role: 'treasurer', where: 'refunds_to_issue' })
      const jobs = await rpc(pool, who.treasurer(2), 'home_jobs', { p_academy: ids.club(2), p_persona: 'treasurer' })
      check(/1 to issue/.test((jobs.data?.jobs ?? []).find((j) => j.id === 'refunds')?.detail ?? ''), { what: 'and their Home says so', expected: '1 to issue', actual: (jobs.data?.jobs ?? []).find((j) => j.id === 'refunds')?.detail, role: 'treasurer', where: 'home_jobs (treasurer)' })
    }
    // The league's unpaid entry fees: has anyone been chased?
    const owed = await val(pool, `select count(*)::int from public.entry_fees where competition_id = $1 and status = 'owed'`, [COMP])
    const chased = await val(pool, `select count(*)::int from public.notification_queue where kind like 'entry_fee%' or (kind in ('fee_due', 'fee_overdue') and payload ? 'entry_fee_id')`)
    check(owed > 0 && chased > 0, { what: `the ${owed} clubs whose entry fee is still owed in April have been reminded`, expected: '≥1 reminder', actual: `${chased} reminders`, role: 'league treasurer', where: 'queue_fee_reminders (entry fees)', severity: 'medium' })
    const mine = await rpc(pool, who.treasurer(60), 'my_entry_fees', { p_competition: COMP })
    check(mine.ok && JSON.stringify(mine.data ?? '').includes('owed'), { what: 'a club treasurer sees what their club owes the league', expected: 'owed fees listed', actual: mine.ok ? 'listed' : mine.error, role: 'treasurer', where: 'my_entry_fees' })
  })
}

// ================================================================== round 11
export async function round11(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -4)} 10:00`, 'OFF5a a team withdraws mid-season', async () => {
    scenario('OFF5a', 'Off-field issues', 'A team withdraws mid-season: fixtures, ladder and opponents handled')
    const entry = (await sql(pool, `select e.id, e.display_name, e.academy_id, e.team_id from public.competition_entries e where e.competition_id = $1 and e.division = 'U11 Division 3' and e.team_id is not null order by e.display_name limit 1`, [COMP]))[0]
    if (!entry) return
    const remaining = await sql(pool, `select f.id from public.fixtures f where f.competition_id = $1 and (f.home_entry_id = $2 or f.away_entry_id = $2) and f.status in ('scheduled', 'postponed') and f.starts_at > now()`, [COMP, entry.id])
    const played = await val(pool, `select count(*)::int from public.fixtures f where f.competition_id = $1 and (f.home_entry_id = $2 or f.away_entry_id = $2) and f.status in ('final', 'forfeit')`, [COMP, entry.id])
    const hasFn = await val(pool, `select count(*)::int from pg_proc where proname = 'withdraw_entry' and pronamespace = 'public'::regnamespace`)
    if (hasFn) {
      const w = await rpc(pool, who.compManager, 'withdraw_entry', { p_entry: entry.id, p_note: 'The club cannot field the side after Easter' })
      mustWork(w, { what: 'the competition manager withdraws the team', role: 'competition manager', where: 'withdraw_entry' })
    } else {
      check(false, { what: 'the league can withdraw a team mid-season in one step', expected: 'a withdraw action', actual: 'none — the league would have to give each remaining game a bye by hand (set_bye) or delete the entry, which deletes every played game with it (on delete cascade)', role: 'competition manager', where: 'competition_entries / fixtures', severity: 'high' })
      for (const f of remaining) await rpc(pool, who.compManager, 'set_bye', { p_fixture: f.id })
    }
    const after = await sql(pool, `select status::text, count(*)::int n from public.fixtures f where f.competition_id = $1 and (f.home_entry_id = $2 or f.away_entry_id = $2) group by 1`, [COMP, entry.id])
    const byes = after.find((a) => a.status === 'bye')?.n ?? 0
    const finals = (after.find((a) => a.status === 'final')?.n ?? 0) + (after.find((a) => a.status === 'forfeit')?.n ?? 0)
    check(byes === remaining.length && finals === played, { what: 'the remaining games become byes; the played ones stand', expected: `${remaining.length} byes, ${played} played`, actual: `${byes} byes, ${finals} played`, role: 'competition manager', where: 'fixtures' })
    const lad = await ladder(pool, 'U11 Division 3', who.compManager)
    const row = lad.find((x) => x.entry_id === entry.id)
    check(row && row.played === played, { what: 'the ladder keeps the team\'s played games and counts no bye', expected: `played ${played}`, actual: `played ${row?.played}`, role: 'parent', where: 'competition_ladder' })
    // The opponents' families: their game against the withdrawn team is off.
    const opp = remaining[0] ? await game(pool, remaining[0].id) : null
    if (opp) {
      const oppClub = opp.home_entry_id === entry.id ? opp.away_club : opp.home_club
      const ev = await eventFor(pool, opp.id, oppClub)
      const cancelled = await val(pool, `select cancelled_at is not null from public.events where id = $1`, [ev])
      check(cancelled === true, { what: 'an opponent\'s family sees the game is off (a bye)', expected: 'cancelled on their calendar', actual: cancelled ? 'cancelled' : 'STILL ON', role: 'parent', where: 'mirror_fixture (bye)', severity: 'high' })
      const told = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where kind = 'event_cancelled' and payload->>'event_id' = $1::text`, [ev])
      check(told > 0, { what: 'and was told', expected: '>0', actual: told, role: 'parent', where: 'notify_event_change', severity: 'high' })
    }
    const marked = await val(pool, `select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'competition_entries' and column_name = 'withdrawn_at'`)
    check(marked === 1, { what: 'the entry is marked withdrawn, so the draw and the ladder can say so', expected: 'withdrawn_at set', actual: marked ? 'column exists' : 'no such column', role: 'competition manager', where: 'competition_entries', severity: 'medium' })
    ctx.withdrawn = entry
  })
}

// ================================================================== round 12
export async function round12(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, 1)} 12:00`, 'R5 points deducted; ladder ties; MiniRoos without scores or a ladder', async () => {
    scenario('R5', 'Results', 'Points deduction, ladder ties (goal difference, goals for, head-to-head), hidden scores and no ladder for U9')
    const division = 'U13 Division 2'
    const before = await ladder(pool, division, who.compManager)
    const target = before[0]
    const adj = await run(pool, who.compManager, `insert into public.ladder_adjustments (competition_id, division, entry_id, points, reason, made_by) values ($1, $2, $3, -3, 'Fielded an unregistered player in Round 9', $4) returning id`, [COMP, division, target.entry_id, who.compManager])
    mustWork(adj, { what: 'the league deducts three points, with a reason', role: 'competition manager', where: 'ladder_adjustments' })
    const after = await ladder(pool, division, who.compManager)
    const row = after.find((x) => x.entry_id === target.entry_id)
    check(row.points === target.points - 3, { what: 'the ladder shows three fewer points', expected: target.points - 3, actual: row.points, role: 'parent', where: 'competition_ladder' })
    const parent = await guardianOf(pool, (await squad(pool, (await val(pool, `select team_id from public.competition_entries where id = $1`, [target.entry_id])))).players[0])
    const br = await rpc(pool, parent, 'competition_ladder_breakdown', { p_competition: COMP, p_division: division, p_entry: target.entry_id })
    check(br.ok && JSON.stringify(br.data ?? '').includes('unregistered player'), { what: 'a family tapping the row sees the deduction and why (the ladder audit)', expected: 'the reason in the breakdown', actual: br.ok ? (JSON.stringify(br.data).includes('unregistered') ? 'shown' : 'not shown') : br.error, role: 'parent', where: 'competition_ladder_breakdown' })
    // Ties: level on points, goal difference decides; then goals for; two fully level sit together by name (head-to-head is deliberately not applied).
    const lad = await ladder(pool, 'U17 Division 3', who.compManager)
    let okOrder = true
    for (let i = 1; i < lad.length; i++) {
      const a = lad[i - 1], b = lad[i]
      if (a.points < b.points || (a.points === b.points && a.goal_difference < b.goal_difference) || (a.points === b.points && a.goal_difference === b.goal_difference && a.goals_for < b.goals_for)) okOrder = false
    }
    check(okOrder, { what: 'the ladder orders by points, then goal difference, then goals for', expected: 'ordered', actual: okOrder ? 'ordered' : lad.map((x) => `${x.points}/${x.goal_difference}/${x.goals_for}`).join(' '), role: 'parent', where: 'app_private.ladder' })
    check(true, { what: 'two sides level on all three sit together, alphabetically — head-to-head is deliberately not applied (CLAUDE.md), the organiser rules', expected: 'by design', actual: 'by design', role: 'league', where: 'app_private.ladder' })
    // MiniRoos: no public ladder, no scores.
    const pub = await asAnon(pool, async (c) => (await c.query(`select public.public_competition_entry('spl-season-4') j`)).rows[0].j)
    const text = JSON.stringify(pub.data ?? '')
    const u9pub = (pub.data?.divisions ?? pub.data?.ladders ?? []).filter?.((d) => /U9/.test(JSON.stringify(d))) ?? []
    check(pub.ok && !/"U9 Division 1"[^]*?"points"/.test(text.slice(0, 200000)) , { what: 'the public match centre has no U9 ladder', expected: 'no points for U9', actual: pub.ok ? (u9pub.length ? `${u9pub.length} U9 blocks` : 'no U9 ladder') : pub.error, role: 'stranger', where: 'public_competition_entry', quiet: false })
    const u9 = await ladder(pool, 'U9 Division 1', who.compManager)
    const u9parent = await guardianOf(pool, (await squad(pool, (await val(pool, `select team_id from public.competition_entries where competition_id = $1 and division = 'U9 Division 1' and team_id is not null limit 1`, [COMP])))).players[0])
    const u9fam = await ladder(pool, 'U9 Division 1', u9parent)
    check(u9fam.length === 0 || u9fam.every((r) => r.points === 0 && r.played === 0), { what: 'a U9 family sees no ladder (ladder_enabled off)', expected: 'empty', actual: `${u9fam.length} rows`, role: 'parent', where: 'competition_ladder (ladder_enabled)', severity: 'high' })
    const u9game = (await gamesOn(pool, S, { division: 'U9 Division 1' })).find((g) => g.status === 'final')
    if (u9game) {
      const ev = await eventFor(pool, u9game.id, u9game.home_club)
      const res = await rpc(pool, u9parent, 'event_result', { p_event: ev })
      const fx = await rpc(pool, u9parent, 'fixtures_screen', { p_days: 21, p_academy: u9game.home_club })
      const shows = JSON.stringify(fx.data ?? '').includes(`"home_score":${u9game.home_score}`) || (res.ok && Array.isArray(res.data) && res.data.length > 0 && res.data[0].ours !== null)
      check(!shows, { what: 'a U9 family is not shown the score (scores_public off)', expected: 'no score', actual: shows ? 'score shown' : 'hidden', role: 'parent', where: 'fixtures_screen / event_result', severity: 'medium' })
    }
    void u9
  })
}

// ================================================================== round 13
export async function round13(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -3)} 19:00`, 'OFF7c games around midnight land on the right day', async () => {
    scenario('OFF7c', 'Off-field issues', 'Games around midnight land on the right day')
    const sq = await squad(pool, ids.team(5))
    const late = await run(pool, sq.coach, `insert into public.events (academy_id, team_id, type, title, starts_at, ends_at, venue, created_by) values ($1, $2, 'social', 'Presentation night (late)', $3, $4, 'Clubhouse', $5) returning id`, [sq.academy_id, sq.id, new Date(`${S}T23:30:00+10:00`).toISOString(), new Date(`${plusDays(S, 1)}T00:30:00+10:00`).toISOString(), sq.coach])
    const early = await run(pool, sq.coach, `insert into public.events (academy_id, team_id, type, title, starts_at, ends_at, venue, created_by) values ($1, $2, 'other', 'Bus leaves for the tournament', $3, $4, 'Clubhouse', $5) returning id`, [sq.academy_id, sq.id, new Date(`${plusDays(S, 1)}T00:30:00+10:00`).toISOString(), new Date(`${plusDays(S, 1)}T01:00:00+10:00`).toISOString(), sq.coach])
    mustWork(late, { what: 'an 11:30 pm Saturday event is made', role: 'coach', where: 'events' })
    mustWork(early, { what: 'and a 12:30 am Sunday one', role: 'coach', where: 'events' })
    const sat = await rpc(pool, sq.coach, 'whats_on', { p_academy: sq.academy_id, p_date: S })
    const sun = await rpc(pool, sq.coach, 'whats_on', { p_academy: sq.academy_id, p_date: plusDays(S, 1) })
    const satIds = (sat.data ?? []).map((e) => e.event_id), sunIds = (sun.data ?? []).map((e) => e.event_id)
    check(satIds.includes(late.data?.[0]?.id) && !satIds.includes(early.data?.[0]?.id), { what: 'Saturday\'s list has the 11:30 pm event and not the 12:30 am one', expected: 'late on Saturday only', actual: `late ${satIds.includes(late.data?.[0]?.id)}, early ${satIds.includes(early.data?.[0]?.id)}`, role: 'coach', where: 'whats_on' })
    check(sunIds.includes(early.data?.[0]?.id), { what: 'Sunday\'s list has the 12:30 am one', expected: 'listed', actual: sunIds.includes(early.data?.[0]?.id), role: 'coach', where: 'whats_on' })
    const parent = await guardianOf(pool, sq.players[0])
    const up = await rpc(pool, parent, 'my_upcoming_events', { p_academy: sq.academy_id, p_days: 14 })
    const fmt = (d) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d))
    const l = (up.data ?? []).find((e) => e.id === late.data?.[0]?.id), e = (up.data ?? []).find((x) => x.id === early.data?.[0]?.id)
    check(l && e && fmt(l.starts_at).startsWith('Sat') && fmt(e.starts_at).startsWith('Sun'), { what: 'a family\'s list says Saturday 23:30 and Sunday 00:30', expected: 'Sat 23:30 / Sun 00:30', actual: `${l ? fmt(l.starts_at) : '—'} / ${e ? fmt(e.starts_at) : '—'}`, role: 'parent', where: 'my_upcoming_events' })
  })
  add(`${plusDays(S, -4)} 20:00`, 'PM2 a club message to a thousand people; a league notice to eleven thousand', async () => {
    scenario('PM2', 'People & messaging', 'Club messages to thousands')
    const members = await val(pool, `select count(*)::int from public.academy_members where academy_id = $1 and status = 'active'`, [ids.club(1)])
    const t0 = clock.iso()
    const m = await rpc(pool, who.president(1), 'send_club_message', { p_academy: ids.club(1), p_body: 'URGENT: Harbour Park is closed tomorrow after a burst water main. Every game and session there is off; the league will post new times.', p_audience: JSON.stringify({ kind: 'club' }), p_pinned: true, p_until: null, p_urgent: true })
    mustWork(m, { what: `the President of the biggest club (${members} members) sends an urgent message to everyone`, role: 'president', where: 'send_club_message' })
    const cm = await sql(pool, `select recipient_count, status from public.club_messages where id = $1`, [m.data])
    check(cm[0]?.recipient_count === members - 1, { what: 'it is addressed to every member but the sender', expected: members - 1, actual: cm[0]?.recipient_count, role: 'president', where: 'send_club_message' })
    ctx.bigMessage = { id: m.data, at: t0, expected: members - 1 }
    const chan = await noticesChannel(pool)
    const n = await say(pool, who.compManager, chan, LEAGUE, 'Two rounds to go. Finals dates: semi-finals 29 May, grand finals 5 June. Eligibility is five games.', { audience: 'everyone', is_announcement: true })
    const people = await val(pool, `select count(*)::int from app_private.notices_people($1)`, [COMP])
    const q = await val(pool, `select count(*)::int from public.notification_queue where payload->>'message_id' = $1::text`, [n.data?.[0]?.id])
    check(q >= people - 1, { what: `a league notice is queued for all ${people} people in one write`, expected: people - 1, actual: q, role: 'competition manager', where: 'enqueue_message_notification (notices)' })
  })
  add(`${plusDays(S, -4)} 20:45`, 'PM2 the fan-out finished within the hour', async () => {
    if (!ctx.bigMessage) return
    const cm = await sql(pool, `select recipient_count, status, (select count(*) from public.club_message_recipients r where r.message_id = $1 and r.notified_at is not null)::int as notified from public.club_messages where id = $1`, [ctx.bigMessage.id])
    check(cm[0]?.status === 'sent' && cm[0]?.notified === ctx.bigMessage.expected, { what: 'every recipient was notified in batches within forty-five minutes', expected: `sent, ${ctx.bigMessage.expected} notified`, actual: `${cm[0]?.status}, ${cm[0]?.notified} notified`, role: 'president', where: 'fan_out_club_messages' })
    const sentRows = await val(pool, `select count(*)::int from public.notification_queue where payload->>'club_message_id' = $1::text and sent_at is not null`, [ctx.bigMessage.id])
    check(sentRows === ctx.bigMessage.expected, { what: 'and every push went (urgent: quiet hours do not hold it)', expected: ctx.bigMessage.expected, actual: sentRows, role: 'parent', where: 'claim_notifications' })
    const seen = await rpc(pool, ids.parent(1, 9), 'my_club_messages', { p_academy: ids.club(1) })
    check(JSON.stringify(seen.data ?? '').includes(ctx.bigMessage.id), { what: 'a family sees it under Messages', expected: 'listed', actual: seen.ok ? 'listed or not' : seen.error, role: 'parent', where: 'my_club_messages' })
  })
}

// ================================================================== round 14
export async function round14(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -1)} 11:30`, 'R6 a late signing with one game before the finals', async () => {
    const entry = (await sql(pool, `select e.id, e.academy_id, e.team_id from public.competition_entries e where e.competition_id = $1 and e.division = 'U15 Division 1' and e.team_id is not null order by e.display_name limit 1`, [COMP]))[0]
    const spare = await val(pool, `select pl.id from public.players pl where pl.academy_id = $1 and pl.team_id <> $2 and not exists (select 1 from public.entry_squads s where s.player_id = pl.id) and pl.dob < '2013-01-01' limit 1`, [entry.academy_id, entry.team_id])
    if (!spare) return
    const add_ = await run(pool, who.secretary(await clubOf(pool, entry.academy_id)), `insert into public.entry_squads (competition_id, entry_id, academy_id, player_id, added_by) values ($1, $2, $3, $4, $5) returning id`, [COMP, entry.id, entry.academy_id, spare, who.secretary(await clubOf(pool, entry.academy_id))])
    if (add_.ok) ctx.lateSigning = { entry: entry.id, player: spare, team: entry.team_id }
    const g = (await gamesOn(pool, S, { division: 'U15 Division 1', status: 'scheduled' })).find((x) => x.home_entry_id === entry.id || x.away_entry_id === entry.id)
    if (g && ctx.lateSigning) await submitSheet(pool, g, g.home_entry_id === entry.id ? 'home' : 'away', { n: 11, extra: [spare] })
  })
  add(`${plusDays(S, 1)} 12:30`, 'the regular season\'s ladders', async () => {
    ctx.finalLadders = {}
    for (const d of ['U11 Division 1', 'U13 Division 1', 'U15 Division 1', 'U17 Division 1']) ctx.finalLadders[d] = await ladder(pool, d, who.compManager)
    return Object.fromEntries(Object.entries(ctx.finalLadders).map(([d, l]) => [d, l.slice(0, 2).map((x) => `${x.team_name} ${x.points}`)]))
  })
}

// ==================================================================== finals
export async function finals(ctx, add) {
  const { pool } = ctx
  // The catch-up round (22 May) is played by the routine like any Saturday (the driver finds the date in the draw).
  add('2027-05-23 10:00', 'R6 the finals are set up: semi-finals 29 May, grand finals 5 June', async () => {
    scenario('R6', 'Results', 'Finals: eligibility (minimum games), semi-finals, a grand final, extra time and penalties recorded')
    const top4 = await (await import('./scenarios.mjs')).hasParam(pool, 'create_finals', 'p_top')
    let made = 0
    ctx.finalsDivisions = ['U11 Division 1', 'U13 Division 1', 'U15 Division 1', 'U17 Division 1']
    for (const [i, d] of ctx.finalsDivisions.entries()) {
      const args = { p_competition: COMP, p_division: d, p_start_at: new Date(`2027-05-29T${['08:00', '10:00', '12:00', '14:00'][i]}:00+10:00`).toISOString(), p_game_mins: [50, 60, 70, 80][i], p_gap_mins: 20, p_fields: ['Field 1', 'Field 2'], p_venue_label: 'Harbour Park' }
      if (top4) { args.p_top = 4; args.p_final_at = new Date(`2027-06-05T${['08:00', '10:00', '12:00', '14:00'][i]}:00+10:00`).toISOString() }
      const r = await rpc(pool, who.compManager, 'create_finals', args)
      if (r.ok) made += r.data; else note(`create_finals ${d}: ${r.error}`)
    }
    const semis = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and stage = 'final' and round like 'Semi%'`, [COMP])
    const gfs = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and stage = 'final' and round = 'Final'`, [COMP])
    check(semis === 8 && gfs === 4, { what: 'four divisions get two semi-finals and a grand final each (the top four of one table)', expected: '8 semis, 4 finals', actual: `${semis} semis, ${gfs} finals${top4 ? '' : ' — create_finals makes only a final for a one-group division'}`, role: 'competition manager', where: 'create_finals', severity: 'medium' })
    const filled = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and stage = 'final' and round like 'Semi%' and home_entry_id is not null and away_entry_id is not null`, [COMP])
    check(filled === semis, { what: 'the semi-finals are seeded from the ladders as soon as the season is complete', expected: semis, actual: filled, role: 'competition manager', where: 'resolve_finals' })
    return { made, semis, gfs, filled }
  })
  add('2027-05-28 12:00', 'R6 eligibility: the late signing is refused for the final', async () => {
    const ls = ctx.lateSigning
    if (!ls) return
    const sf = (await sql(pool, `select f.* , h.team_id home_team, a.team_id away_team from public.fixtures f left join public.competition_entries h on h.id = f.home_entry_id left join public.competition_entries a on a.id = f.away_entry_id where f.competition_id = $1 and f.stage = 'final' and (f.home_entry_id = $2 or f.away_entry_id = $2) and f.status = 'scheduled' order by f.starts_at limit 1`, [COMP, ls.entry]))[0]
    if (!sf) { note('the late signing\'s team did not make the finals'); check(true, { what: 'eligibility checked on a team that made the finals', expected: '—', actual: 'the team did not qualify; covered by the ineligibility rule', role: 'coach', where: 'ineligibility', quiet: true }); return }
    const side = sf.home_entry_id === ls.entry ? 'home' : 'away'
    const r = await submitSheet(pool, sf, side, { n: 11, extra: [ls.player] })
    mustRefuse(r, { what: 'a player with one season game is refused for a final (five needed)', role: 'coach', where: 'ineligibility (finals_min_games)' })
    if (!r.ok) check(/a final needs 5/.test(r.error), { what: 'the refusal says how many', expected: '… has played 1 of the season\'s games; a final needs 5', actual: r.error, role: 'coach', where: 'ineligibility' })
    await submitSheet(pool, sf, side, { n: 11, skip: [ls.player] })
  })
  add('2027-05-29 07:00', 'R6 one semi-final is kept for the penalties scenario', async () => {
    const semi = (await sql(pool, `select f.* from public.fixtures f where f.competition_id = $1 and f.stage = 'final' and f.round like 'Semi%' and f.division = 'U15 Division 1' and f.home_entry_id is not null order by f.starts_at limit 1`, [COMP]))[0]
    if (semi) { ctx.reserved = ctx.reserved ?? new Set(); ctx.reserved.add(semi.id); ctx.drawnSemi = semi }
  })
  add('2027-05-30 10:00', 'R6 a semi-final decided on penalties', async () => {
    const drawn = ctx.drawnSemi ? await game(pool, ctx.drawnSemi.id) : null
    if (!drawn) return
    const pens = await (await import('./scenarios.mjs')).hasParam(pool, 'rule_on_score', 'p_pens_home')
    if (drawn.status !== 'final') {
      const r = pens
        ? await rpc(pool, who.compManager, 'rule_on_score', { p_fixture: drawn.id, p_home: 2, p_away: 2, p_note: 'After extra time; 4–3 on penalties', p_pens_home: 4, p_pens_away: 3 })
        : await rpc(pool, who.compManager, 'rule_on_score', { p_fixture: drawn.id, p_home: 2, p_away: 2, p_note: 'After extra time; 4–3 on penalties' })
      mustWork(r, { what: 'the league records 2–2 after extra time, 4–3 on penalties', role: 'competition manager', where: 'rule_on_score' })
    }
    const gf = (await sql(pool, `select home_entry_id, away_entry_id, home_source, away_source from public.fixtures where competition_id = $1 and division = $2 and round = 'Final'`, [COMP, drawn.division]))[0]
    const promoted = gf && (gf.home_entry_id === drawn.home_entry_id || gf.away_entry_id === drawn.home_entry_id)
    check(promoted, { what: 'the penalty winner goes through to the grand final', expected: 'home side in the final', actual: promoted ? 'through' : `final has ${gf?.home_entry_id ? 'a home side' : 'NO home side'} / ${gf?.away_entry_id ? 'an away side' : 'NO away side'}${pens ? '' : ' — a drawn knockout has no way to record the shootout'}`, role: 'competition manager', where: 'resolve_source (W:)', severity: 'high' })
  })
  add('2027-06-05 19:00', 'SCREENS the finals', () => runScreens(ctx, 'finals'))
  add('2027-06-05 18:00', 'R6 the grand finals', async () => {
    const gfs = await sql(pool, `select f.*, h.display_name home_name, a.display_name away_name from public.fixtures f left join public.competition_entries h on h.id = f.home_entry_id left join public.competition_entries a on a.id = f.away_entry_id where f.competition_id = $1 and f.stage = 'final' and f.round = 'Final' order by f.starts_at`, [COMP])
    const played = gfs.filter((g) => g.status === 'final').length
    check(played >= 3, { what: 'the grand finals were played and have results', expected: '≥3 of 4 final', actual: `${played} of ${gfs.length}: ${gfs.map((g) => `${g.home_name ?? '?'} ${g.home_score ?? '-'}–${g.away_score ?? '-'} ${g.away_name ?? '?'} (${g.status})`).join('; ')}`, role: 'league', where: 'fixtures (finals)' })
    const et = gfs.find((g) => g.status === 'final')
    if (et) {
      const r = await rpc(pool, who.compManager, 'request_match_correction', { p_fixture: et.id, p_kind: 'other', p_detail: 'Record: the final went to extra time (1–1 at 90), won 2–1 in the 104th minute', p_home: null, p_away: null })
      check(r.ok || /already/.test(r.error ?? ''), { what: 'extra time is recorded against the game', expected: 'noted', actual: r.ok ? 'noted as a correction/note' : r.error, role: 'competition manager', where: 'request_match_correction (other)', severity: 'low' })
    }
  })
}

export async function closing(ctx) {
  ctx.needsJoey = ctx.needsJoey ?? []
}

export { pick }
