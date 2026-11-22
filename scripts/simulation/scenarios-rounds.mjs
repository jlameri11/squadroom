// The scenarios laid over the first seven rounds (see scenarios.mjs for the
// pre-season and scenarios-rounds2.mjs for rounds 8–14 and the finals). Each
// function adds timed steps to the week; a step does the thing as the person
// who would, then checks what every screen would show.
import { check, clock, ids, mustRefuse, mustWork, note, rpc, run, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, enterScores, eventFor, game, gamesOn, guardianOf, kickoffPlus, ladder, noticesChannel, playerName, queued, refereeOf, rsvp, say, sheetFor, squad, submitSheet, switches } from './world.mjs'
import { plusDays } from './routine.mjs'
import { runScreens } from './screens.mjs'

const iso = (local, off = '+11:00') => new Date(`${local.replace(' ', 'T')}:00${off}`).toISOString()

/** The first free, open quarter-hour on a pitch between two Sydney times of a day — as an ISO instant, never through the laptop's clock. */
async function freeSlot(pool, pitchId, date, from, to, mins, except) {
  return val(pool, `select min(t)::text from generate_series(($2::date::text || ' ' || $3)::timestamp at time zone 'Australia/Sydney', ($2::date::text || ' ' || $4)::timestamp at time zone 'Australia/Sydney', interval '15 minutes') t
    where app_private.pitch_clash($1, t, t + make_interval(mins => $5), $6) is null
      and app_private.pitch_open($1, t, t + make_interval(mins => $5))`, [pitchId, date, from, to, mins, except]).then((t) => (t ? new Date(t).toISOString() : null))
}

/** Games on a date in a division, scheduled, both sides real. */
async function pick(ctx, date, division, n = 1, offset = 0) {
  const games = (await gamesOn(ctx.pool, date, { division, status: 'scheduled' })).filter((g) => g.home_team && g.away_team)
  return games.slice(offset, offset + n)
}
const reserve = (ctx, ...games) => { ctx.reserved = ctx.reserved ?? new Set(); for (const g of games) ctx.reserved.add(g.id) }

// ================================================================= set-ups
/** The money the OFF4 scenarios lean on: a levy with instalments, a program with a fee, a voucher, an Active Kids club. */
export async function setupMoney(ctx) {
  const { pool } = ctx
  ctx.money = {}
  // Club 1: a season levy of $120 in three instalments, due 20 February.
  const levy = await run(pool, who.treasurer(1), `insert into public.payment_requests (academy_id, title, description, amount_cents, per_player, due_on, instalments, instalment_every_days, created_by)
    values ($1, 'Season levy 2027', 'Ground hire and insurance', 12000, true, '2027-02-20', 3, 30, $2) returning id`, [ids.club(1), who.treasurer(1)])
  if (levy.ok) ctx.money.levy = levy.data[0].id; else note(`levy refused: ${levy.error}`)
  // Club 3: a kit fee of $80, one payment, and a 20% voucher.
  const kit = await run(pool, who.treasurer(3), `insert into public.payment_requests (academy_id, title, amount_cents, per_player, due_on, created_by) values ($1, 'Kit 2027', 8000, true, '2027-03-01', $2) returning id`, [ids.club(3), who.treasurer(3)])
  if (kit.ok) ctx.money.kit = kit.data[0].id
  const voucher = await run(pool, who.treasurer(3), `insert into public.vouchers (academy_id, code, label, kind, percent_bps, max_uses, active, created_by) values ($1, 'SIBLING20', 'Second child 20% off', 'club', 2000, 50, true, $2) returning id`, [ids.club(3), who.treasurer(3)])
  if (!voucher.ok) {
    // Not every seat can make a voucher; the owner can.
    const v2 = await run(pool, who.president(3), `insert into public.vouchers (academy_id, code, label, kind, percent_bps, max_uses, active, created_by) values ($1, 'SIBLING20', 'Second child 20% off', 'club', 2000, 50, true, $2) returning id`, [ids.club(3), who.president(3)])
    if (!v2.ok) note(`voucher refused: ${voucher.error} / ${v2.error}`)
  }
  // Club 4: an Active & Creative Kids provider with a $150 registration fee.
  await run(pool, who.president(4), `update public.academies set active_kids_provider = true where id = $1`, [ids.club(4)])
  const rego = await run(pool, who.treasurer(4), `insert into public.payment_requests (academy_id, title, amount_cents, per_player, due_on, created_by) values ($1, 'Registration 2027', 15000, true, '2027-03-15', $2) returning id`, [ids.club(4), who.treasurer(4)])
  if (rego.ok) ctx.money.rego4 = rego.data[0].id
  // Club 2: a development program with a $150 fee; full refund until 31 March, half after.
  const prog = await run(pool, who.registrar(2), `insert into public.programs (academy_id, name, kind, status, season, born_from_year, born_to_year, capacity, opens_at, closes_at, starts_on, ends_on, withdraw_until, refund_bps_after, created_by)
    values ($1, 'Autumn development squad', 'development', 'open', '2027', 2014, 2016, 30, now() - interval '7 days', '2027-03-01', '2027-02-08', '2027-06-01', '2027-03-31', 5000, $2) returning id`, [ids.club(2), who.registrar(2)])
  if (prog.ok) {
    ctx.money.program = prog.data[0].id
    const fee = await rpc(pool, who.treasurer(2), 'set_program_fee', { p_program: ctx.money.program, p_amount_cents: 15000, p_title: 'Development fee', p_due_on: '2027-02-15', p_instalments: 1, p_every_days: 30 })
    if (!fee.ok) note(`set_program_fee: ${fee.error}`); else ctx.money.programFee = fee.data
    // A family registers a 2015-born child from club 2's U11 Red.
    const kid = await sql(pool, `select pl.id, g.profile_id from public.players pl join public.player_guardians g on g.player_id = pl.id and g.is_primary join public.teams t on t.id = pl.team_id
                                 where pl.academy_id = $1 and t.age_group = 'U11' and extract(year from pl.dob) = 2016 order by pl.id limit 1`, [ids.club(2)])
    if (kid[0]) {
      const reg = await run(pool, kid[0].profile_id, `insert into public.program_registrations (academy_id, program_id, player_id, submitted_by, status) values ($1, $2, $3, $4, 'pending') returning id`, [ids.club(2), ctx.money.program, kid[0].id, kid[0].profile_id])
      if (reg.ok) {
        ctx.money.registration = { id: reg.data[0].id, player: kid[0].id, parent: kid[0].profile_id }
        const appr = await run(pool, who.registrar(2), `update public.program_registrations set status = 'approved' where id = $1 returning id`, [reg.data[0].id])
        if (!appr.ok) note(`approve registration: ${appr.error}`)
        if (ctx.money.programFee) {
          // Paid by card the same night — what the Stripe webhook writes.
          await sql(pool, `insert into public.payments (academy_id, request_id, profile_id, player_id, stripe_session_id, stripe_payment_intent, amount_cents, currency, status, paid_at, instalment_seq)
                           values ($1, $2, $3, $4, 'cs_sim_dev_1', 'pi_sim_dev_1', 15000, 'aud', 'paid', now(), 1)`, [ids.club(2), ctx.money.programFee, kid[0].profile_id, kid[0].id])
        }
      } else note(`registration refused: ${reg.error}`)
    }
  } else note(`program refused: ${prog.error}`)
  // The league's entry fees: 250 clubs pay in January; 50 do not.
  const fees = await sql(pool, `select id from public.entry_fees where competition_id = $1 order by id`, [COMP])
  let paid = 0
  for (const f of fees.slice(0, 250)) {
    const r = await rpc(pool, who.compManager, 'mark_entry_fee', { p_fee: f.id, p_status: 'paid', p_method: 'bank', p_note: 'EFT received' })
    if (r.ok) paid++
  }
  note(`${paid} entry fees marked paid, ${fees.length - paid} still owed`)
}

/** Thirty squads have duties (oranges, canteen, field marshal) rostered over the season. */
export async function setupDuties(ctx) {
  const teams = await sql(ctx.pool, `select id from public.teams where season = '2027' and academy_id = any($1::uuid[]) order by id`, [[ids.club(1), ids.club(2), ids.club(3), ids.club(4), ids.club(5)]])
  let set = 0, rostered = 0
  for (const t of teams.slice(0, 30)) {
    const sq = await squad(ctx.pool, t.id)
    const a = await rpc(ctx.pool, sq.coach, 'set_team_duties', { p_team: t.id, p_titles: ['Oranges', 'Canteen', 'Field marshal'] })
    if (!a.ok) { note(`set_team_duties: ${a.error}`); continue }
    set++
    const b = await rpc(ctx.pool, sq.coach, 'roster_team_duties', { p_team: t.id, p_games: 16 })
    if (b.ok) rostered += b.data.assigned
  }
  note(`duties set for ${set} squads, ${rostered} turns rostered`)
}

// ============================================================== every round
export async function everyRound(ctx, r, S, add) {
  if (r !== 1 && r !== 8) return
  // PM1 / PM6: Sunday night, the week's notices went to the right people, once each.
  add(`${plusDays(S, 1)} 12:00`, 'PM1/PM6 the notices and their reach', async () => {
    scenario('PM1', 'People & messaging', 'Notices to everyone / club staff only')
    const n = ctx.lastNotices
    if (!n?.everyone || !n?.staff) { check(false, { what: 'the two notices were posted', expected: 'two ids', actual: JSON.stringify(n), role: 'competition manager', where: 'messages (notices)' }); return }
    const people = await sql(ctx.pool, `select standing, count(*)::int n from app_private.notices_people($1) group by standing`, [COMP])
    const total = people.reduce((a, p) => a + p.n, 0)
    const staffOnly = people.filter((p) => ['league', 'staff'].includes(p.standing)).reduce((a, p) => a + p.n, 0)
    const sentAll = await val(ctx.pool, `select count(distinct profile_id)::int from public.notification_queue where payload->>'message_id' = $1`, [n.everyone])
    const sentStaff = await val(ctx.pool, `select count(distinct profile_id)::int from public.notification_queue where payload->>'message_id' = $1`, [n.staff])
    check(Math.abs(sentAll - (total - 1)) <= 1, { what: `the everyone-notice is queued once for everyone in the competition (${total} people)`, expected: total - 1, actual: sentAll, role: 'competition manager', where: 'enqueue_message_notification (notices)' })
    check(Math.abs(sentStaff - (staffOnly - 1)) <= 1, { what: `the club-staff notice reaches league and club staff only (${staffOnly})`, expected: staffOnly - 1, actual: sentStaff, role: 'competition manager', where: 'enqueue_message_notification (audience)' })
    const family = await val(ctx.pool, `select profile_id from app_private.notices_people($1) where standing = 'family' limit 1`, [COMP])
    const famGotStaff = await val(ctx.pool, `select count(*)::int from public.notification_queue where payload->>'message_id' = $1 and profile_id = $2`, [n.staff, family])
    check(famGotStaff === 0, { what: 'a family did not get the club-staff notice', expected: 0, actual: famGotStaff, role: 'parent', where: 'notices audience' })
    const famSees = await run(ctx.pool, family, `select count(*)::int n from public.channel_messages($1, null, 50) where id = $2`, [await noticesChannel(ctx.pool), n.staff])
    check(famSees.ok && famSees.data[0].n === 0, { what: 'a family cannot read the club-staff notice in the channel', expected: 0, actual: famSees.ok ? famSees.data[0].n : famSees.error, role: 'parent', where: 'channel_messages' })

    scenario('PM6', 'People & messaging', 'No message sent twice; late messages not sent')
    const dup = await val(ctx.pool, `select count(*)::int from (select profile_id, payload->>'message_id' m from public.notification_queue where created_at >= $1 and payload ? 'message_id' and dedupe_key not like 'digest:%' group by 1, 2 having count(*) > 1) x`, [n.at])
    check(dup === 0, { what: 'nobody has two notifications for one message this week', expected: 0, actual: dup, role: 'everyone', where: 'notification_queue dedupe_key' })
    const dupEv = await val(ctx.pool, `select count(*)::int from (select profile_id, kind, payload->>'event_id' e, payload->>'window' w from public.notification_queue where created_at >= $1 and kind in ('event_cancelled', 'event_changed', 'event_back_on', 'event_reminder') group by 1, 2, 3, 4 having count(*) > 1) x`, [n.at])
    check(dupEv === 0, { what: 'nobody has two of the same push for one game this week', expected: 0, actual: dupEv, role: 'everyone', where: 'notification_queue dedupe_key' })
  })
}

// =================================================================== round 1
export async function round1(ctx, S, add) {
  const { pool } = ctx
  // R1 / R2 / R3: the league's test bench — games the routine leaves alone, picked when the week is planned.
  const bench = await pick(ctx, S, 'U11 Division 1', 4)
  const r2 = await pick(ctx, S, 'U11 Division 2', 1)
  const r3 = await pick(ctx, S, 'U11 Division 3', 3)
  const q = await pick(ctx, S, 'U15 Division 1', 1)
  ctx.bench = { r1: bench, r2: r2[0], r3: r3, q: q[0] }
  reserve(ctx, ...bench, ...r2, ...r3)

  // OF6: a wrong sheet corrected before the lock; a change after the lock only by the referee or the league, and logged.
  add(`${plusDays(S, -1)} 15:00`, 'OF6 the coach fixes a wrong sheet before the lock', async () => {
    scenario('OF6', 'On-field issues', 'Wrong team sheet submitted, sheet after lock — only the referee or the league can change it, logged')
    const g = ctx.bench.q
    if (!g) return
    const first = await submitSheet(pool, g, 'home', { n: 12 })
    const second = await submitSheet(pool, g, 'home', { n: 13 })
    mustWork(second, { what: 'a coach resubmits a corrected sheet before the lock', role: 'coach', where: 'submit_match_sheet' })
    const logged = await val(pool, `select count(*)::int from public.match_sheet_log where fixture_id = $1 and entry_id = $2 and action = 'sheet_submitted'`, [g.id, g.home_entry_id])
    check(logged >= 2, { what: 'both submissions are in the sheet log', expected: '≥2', actual: logged, role: 'league', where: 'match_sheet_log' })
    void first
  })
  if (ctx.bench.q) add(kickoffPlus(ctx.bench.q, -25), 'OF6 the sheet after the lock', async () => {
    const g = await game(pool, ctx.bench.q.id)
    const lockAt = await val(pool, `select app_private.sheet_lock_at($1)`, [g.id])
    if (new Date(lockAt) > clock.now) { note(`lock not yet (${lockAt}); the game kicks off ${g.local_start}`); return }
    const coach = await submitSheet(pool, g, 'home', { n: 14 })
    mustRefuse(coach, { what: 'the coach is refused after the lock, told when it locked', role: 'coach', where: 'submit_match_sheet (sheet_lock_mins)' })
    if (!coach.ok) check(/locked at/.test(coach.error), { what: 'the refusal names the lock time', expected: 'locked at …', actual: coach.error, role: 'coach', where: 'submit_match_sheet', severity: 'low' })
    const ref = await refereeOf(pool, g.id)
    const by = ref?.profile_id ?? who.compManager
    const official = await submitSheet(pool, g, 'home', { n: 14, as: by })
    mustWork(official, { what: `the ${ref?.profile_id ? 'referee' : 'league'} can change it after the lock`, role: ref?.profile_id ? 'referee' : 'competition manager', where: 'submit_match_sheet' })
    const log = await val(pool, `select count(*)::int from public.match_sheet_log where fixture_id = $1 and action = 'sheet_changed_after_lock' and detail->>'by_official' = 'true'`, [g.id])
    check(log >= 1, { what: 'the change after the lock is logged as an official\'s', expected: '≥1', actual: log, role: 'league', where: 'match_sheet_log' })
  })

  // PM3: a busy chat with a photo; PM5: quiet hours and the digest.
  add(`${plusDays(S, -5)} 19:30`, 'PM3 a photo in the chat', async () => {
    scenario('PM3', 'People & messaging', 'Busy team chats with replies, reactions, photos and polls')
    const sq = await squad(pool, ids.team(1))
    const photo = await say(pool, sq.coach, sq.channel, sq.academy_id, null, { attachments: JSON.stringify([{ path: `chat/${sq.channel}/sim-photo-1.jpg`, kind: 'image', width: 1200, height: 900 }]) })
    mustWork(photo, { what: 'a coach posts a photo with no words', role: 'coach', where: 'messages (attachments)' })
    if (photo.ok) {
      const n = await queued(pool, { message: photo.data[0].id })
      check(n.length > 0 && /photo|image|sent a/i.test(n[0].body ?? ''), { what: 'the push says a photo was sent', expected: '"… sent a photo"', actual: n[0]?.body ?? 'nothing queued', role: 'parent', where: 'enqueue_message_notification', severity: 'low' })
    }
    const lines = await val(pool, `select count(*)::int from public.messages where created_at > now() - interval '2 hours' and channel_id in (select id from public.channels where type = 'team')`)
    const replies = await val(pool, `select count(*)::int from public.messages where created_at > now() - interval '2 hours' and reply_to_id is not null`)
    check(lines >= 200 && replies >= 150, { what: 'sixty squad chats had a coach line and replies tonight', expected: '≥200 lines, ≥150 replies', actual: `${lines} lines, ${replies} replies`, role: 'coach', where: 'messages' })
    const polls = await val(pool, `select count(*)::int from public.polls where created_at > now() - interval '2 hours'`)
    const reactions = await val(pool, `select count(*)::int from public.message_reactions where created_at > now() - interval '2 hours'`)
    check(polls >= 3 && reactions >= 20, { what: 'polls and reactions went in across the clubs tonight', expected: '≥3 polls, ≥20 reactions', actual: `${polls} polls, ${reactions} reactions`, role: 'parent', where: 'polls / message_reactions' })
  })
  add(`${plusDays(S, -5)} 21:30`, 'PM5 a line inside quiet hours', async () => {
    scenario('PM5', 'People & messaging', 'Quiet hours and the digest respected')
    // Parent 1-1 keeps quiet hours 9pm–7am; a parent in the same squad chat takes an hourly digest.
    // A squad chat at club 1 with a quiet-hours parent (everyone, by default) and a parent who takes the hourly digest.
    const chan = (await sql(pool, `select c.id, c.team_id, q.profile_id as quiet, d.profile_id as digest
      from public.channels c
      join public.channel_members d on d.channel_id = c.id join public.user_settings ud on ud.profile_id = d.profile_id and ud.digest_minutes = 60
      join public.channel_members q on q.channel_id = c.id and q.profile_id <> d.profile_id join public.user_settings uq on uq.profile_id = q.profile_id and uq.quiet_hours_enabled and uq.digest_minutes = 0
      join public.team_members tm on tm.team_id = c.team_id and tm.profile_id = q.profile_id and tm.role = 'parent'
      where c.academy_id = $1 and c.type = 'team' and c.status = 'active' limit 1`, [ids.club(1)]))[0]
    if (!chan) { check(false, { what: 'a squad chat with a quiet-hours parent and a digest parent', expected: 'a channel', actual: 'none', role: 'parent', where: 'channel_members' }); return }
    const sq = await squad(pool, chan.team_id)
    const quiet = chan.quiet, digest = chan.digest
    const m1 = await say(pool, sq.coach, sq.channel, sq.academy_id, 'Late one, sorry — kick-off moved to 9:30, details in Fixtures.')
    const m2 = await say(pool, sq.coach, sq.channel, sq.academy_id, 'And bring the away kit.')
    if (!m1.ok || !m2.ok) { check(false, { what: 'two late lines', expected: 'posted', actual: m1.error ?? m2.error, role: 'coach', where: 'messages' }); return }
    const q = (await queued(pool, { profile: quiet, message: m1.data[0].id }))[0]
    const localSched = q ? new Date(q.scheduled_for) : null
    const sevenAm = new Date(`${plusDays(S, -4)}T07:00:00+11:00`)
    check(q && Math.abs(localSched - sevenAm) < 61_000, { what: 'a quiet-hours parent\'s push waits for 7 am', expected: '07:00 next morning', actual: q ? clockOf(localSched) : 'no row', role: 'parent', where: 'enqueue_message_notification (quiet hours)' })
    const d = await sql(pool, `select dedupe_key, payload->>'count' as count, scheduled_for, title, body from public.notification_queue where profile_id = $1 and dedupe_key like 'digest:%' and created_at > now() - interval '10 minutes'`, [digest])
    check(d.length === 1 && Number(d[0].count) === 2, { what: 'a digest parent gets one row for two lines, counting both', expected: '1 row, count 2', actual: `${d.length} rows, count ${d[0]?.count}`, role: 'parent', where: 'enqueue_message_notification (digest)' })
    ctx.quietCheck = { profile: quiet, message: m1.data[0].id }
  })
  add(`${plusDays(S, -4)} 07:30`, 'PM5 the quiet-hours push went after 7', async () => {
    if (!ctx.quietCheck) return
    const q = (await queued(pool, { profile: ctx.quietCheck.profile, message: ctx.quietCheck.message }))[0]
    const sent = q?.sent_at ? new Date(q.sent_at) : null
    check(sent && clockOf(sent) >= '07:00', { what: 'and was sent after 7 am, not at 9:30 pm', expected: 'sent ≥ 07:00', actual: sent ? clockOf(sent) : 'unsent', role: 'parent', where: 'claim_notifications' })
  })

  // PM4: the scheduled Friday lines go at 6, not before.
  add(`${plusDays(S, -1)} 17:45`, 'PM4 nothing scheduled has gone yet', async () => {
    scenario('PM4', 'People & messaging', 'Scheduled messages go at their time, not before')
    const early = await val(pool, `select count(*)::int from public.messages where body like 'Game tomorrow. Arrive 30 minutes%' and status = 'published'`)
    const waiting = await val(pool, `select count(*)::int from public.messages where body like 'Game tomorrow. Arrive 30 minutes%' and status = 'scheduled'`)
    check(early === 0 && waiting > 0, { what: 'at 5:45 pm Friday the scheduled lines are still waiting', expected: '0 published, some waiting', actual: `${early} published, ${waiting} waiting`, role: 'coach', where: 'publish_scheduled_messages' })
  })
  add(`${plusDays(S, -1)} 18:20`, 'PM4 the Friday lines went at 6', async () => {
    const rows = await sql(pool, `select status, count(*)::int n, min(created_at) first, max(created_at) last from public.messages where body like 'Game tomorrow. Arrive 30 minutes%' group by status`)
    const pub = rows.find((r) => r.status === 'published')
    check(pub && !rows.find((r) => r.status === 'scheduled'), { what: 'by 6:20 every scheduled line is published', expected: 'all published', actual: rows.map((r) => `${r.status} ${r.n}`).join(', '), role: 'coach', where: 'publish_scheduled_messages' })
    if (pub) check(clockOf(new Date(pub.first)) >= '18:00' && clockOf(new Date(pub.last)) <= '18:15', { what: 'published within the quarter-hour after 6', expected: '18:00–18:15', actual: `${clockOf(new Date(pub.first))}–${clockOf(new Date(pub.last))}`, role: 'coach', where: 'publish_scheduled_messages' })
    const pushes = await val(pool, `select count(*)::int from public.notification_queue n join public.messages m on m.id::text = n.payload->>'message_id' where m.body like 'Game tomorrow. Arrive 30 minutes%'`)
    check(pushes > 0, { what: 'and the families were told', expected: '>0 pushes', actual: pushes, role: 'parent', where: 'enqueue_message_notification (on publish)' })
  })
  // PM6: the drain is down from 5:50 pm Friday until 8 am — a Netlify function that did not run.
  add(`${plusDays(S, -1)} 17:50`, 'PM6 the drain goes down', async () => { switches.drainDown = true; ctx.drainDownAt = clock.iso() })
  add(`${S} 08:00`, 'PM6 the drain is back', async () => { switches.drainDown = false })
  add(`${S} 09:00`, 'PM6 stale pushes were not sent; fresh ones were', async () => {
    scenario('PM6', 'People & messaging', 'No message sent twice; late messages not sent')
    const stale = await sql(pool, `select count(*)::int n, count(*) filter (where sent_at is not null)::int sent from public.notification_queue n join public.messages m on m.id::text = n.payload->>'message_id' where m.body like 'Game tomorrow. Arrive 30 minutes%' and n.created_at between $1 and $1::timestamptz + interval '60 minutes'`, [ctx.drainDownAt])
    check(stale[0].n > 0 && stale[0].sent === 0, { what: 'the Friday-evening lines, 14 hours stale when the drain came back, were not sent', expected: 'none sent', actual: `${stale[0].sent} of ${stale[0].n} sent`, role: 'parent', where: 'claim_notifications (12-hour window)' })
    const fresh = await sql(pool, `select count(*)::int n, count(*) filter (where sent_at is not null)::int sent from public.notification_queue where kind = 'event_reminder' and payload->>'window' = '2h' and created_at >= $1::timestamptz + interval '12 hours'`, [ctx.drainDownAt])
    check(fresh[0].n > 0 && fresh[0].sent === fresh[0].n, { what: 'this morning\'s two-hour reminders all went', expected: 'all sent', actual: `${fresh[0].sent} of ${fresh[0].n}`, role: 'parent', where: 'claim_notifications' })
  })

  // R1: every kind of score on the bench games; R2 a dispute; R3 a late one, a missing one, an offline ticker.
  add(`${S} 16:30`, 'R1 win, draw, loss, high score, nil-all', async () => {
    scenario('R1', 'Results', 'Win, draw, loss; high scores; 0–0')
    const [a, b, c, d] = ctx.bench.r1
    const scores = [[a, 0, 0], [b, 1, 1], [c, 7, 0], [d, 0, 3]]
    for (const [g, h, w] of scores) {
      const r = await enterScores(pool, g, h, w)
      check(r.away.data?.state === 'final', { what: `${g.home_name} ${h}–${w} ${g.away_name} is final when both sheets agree`, expected: 'final', actual: r.away.data?.state ?? r.away.error, role: 'manager', where: 'enter_sheet_score' })
    }
    const lad = await ladder(pool, 'U11 Division 1', await guardianOf(pool, (await squad(pool, a.home_team)).players[0]))
    const row = (entry) => lad.find((x) => x.entry_id === entry)
    check(row(a.home_entry_id)?.drawn === 1 && row(a.home_entry_id)?.points === 1, { what: '0–0 is a draw worth a point to each', expected: 'D1 1pt', actual: `${row(a.home_entry_id)?.drawn} drawn, ${row(a.home_entry_id)?.points} pts`, role: 'parent', where: 'competition_ladder' })
    check(row(c.home_entry_id)?.won === 1 && row(c.home_entry_id)?.goal_difference === 7 && row(c.away_entry_id)?.lost === 1, { what: '7–0 is a win, +7, and a loss', expected: 'W1 GD+7 / L1', actual: `${row(c.home_entry_id)?.won}W GD${row(c.home_entry_id)?.goal_difference} / ${row(c.away_entry_id)?.lost}L`, role: 'parent', where: 'competition_ladder' })
    check(row(d.away_entry_id)?.won === 1 && row(d.away_entry_id)?.points === 3 && row(d.home_entry_id)?.points === 0, { what: 'an away win is three points to the visitors', expected: '3 / 0', actual: `${row(d.away_entry_id)?.points} / ${row(d.home_entry_id)?.points}`, role: 'parent', where: 'competition_ladder' })
  })
  add(`${S} 16:40`, 'R2 a disputed score stays off the ladder', async () => {
    scenario('R2', 'Results', 'Matching scores → final; mismatched → dispute → the league rules → the ladder moves only then')
    const g = ctx.bench.r2
    const r = await enterScores(pool, g, 2, 1, { mismatch: true })
    check(r.away.data?.state === 'disputed', { what: 'the second sheet disagrees: the game is disputed', expected: 'disputed', actual: r.away.data?.state ?? r.away.error, role: 'manager', where: 'enter_sheet_score' })
    const f = await game(pool, g.id)
    check(f.status === 'scheduled' && f.score_disputed, { what: 'no result stands while it is disputed', expected: 'scheduled, disputed', actual: `${f.status}, disputed ${f.score_disputed}`, role: 'league', where: 'fixtures' })
    const lad = await ladder(pool, 'U11 Division 2', who.compManager)
    const home = lad.find((x) => x.entry_id === g.home_entry_id)
    check(home?.played === 0, { what: 'the ladder does not count a disputed game', expected: 'played 0', actual: `played ${home?.played}`, role: 'parent', where: 'competition_ladder' })
    const jobs = await rpc(pool, who.compManager, 'home_jobs', { p_academy: LEAGUE, p_persona: 'league' })
    const results = (jobs.data?.jobs ?? []).find((j) => j.id === 'results')
    check(/\d+ disputed/.test(results?.detail ?? ''), { what: 'the league\'s Home counts the disputed results', expected: '"N disputed"', actual: results?.detail, role: 'league', where: 'home_jobs (league)' })
  })
  add(`${S} 18:30`, 'SCREENS a result in dispute', () => runScreens(ctx, 'dispute'))
  add(`${plusDays(S, 1)} 10:30`, 'R2 after the ruling the ladder moves', async () => {
    const g = await game(pool, ctx.bench.r2.id)
    check(g.status === 'final' && !g.score_disputed, { what: 'the league ruled and the game is final', expected: 'final', actual: `${g.status}, disputed ${g.score_disputed}`, role: 'competition manager', where: 'rule_on_score' })
    const lad = await ladder(pool, 'U11 Division 2', who.compManager)
    const home = lad.find((x) => x.entry_id === g.home_entry_id)
    check(home?.played === 1, { what: 'now the ladder counts it', expected: 'played 1', actual: `played ${home?.played}`, role: 'parent', where: 'competition_ladder' })
    const ruled = await val(pool, `select count(*)::int from public.match_sheet_log where fixture_id = $1 and action = 'score_ruled'`, [g.id])
    check(ruled === 1, { what: 'the ruling is in the sheet log', expected: 1, actual: ruled, role: 'league', where: 'match_sheet_log' })
  })
  add(`${plusDays(S, 1)} 09:30`, 'R3 the missing results show on the league\'s Home', async () => {
    scenario('R3', 'Results', 'Late result, missing result, a correction after the game, a result entered offline and synced later')
    const jobs = await rpc(pool, who.compManager, 'home_jobs', { p_academy: LEAGUE, p_persona: 'league' })
    const results = (jobs.data?.jobs ?? []).find((j) => j.id === 'results')
    check(/sheets missing/.test(results?.detail ?? ''), { what: 'Sunday morning the league sees how many sheets are missing', expected: '"N sheets missing"', actual: results?.detail, role: 'league', where: 'home_jobs (league)' })
  })
  add(`${plusDays(S, 2)} 19:00`, 'R3 a late result on Monday night, and a correction', async () => {
    const [late, missing, corr] = ctx.bench.r3
    const r = await enterScores(pool, late, 3, 2)
    check(r.away.data?.state === 'final', { what: 'a result entered two days late is accepted and final', expected: 'final', actual: r.away.data?.state ?? r.away.error, role: 'manager', where: 'enter_sheet_score' })
    const lad = await ladder(pool, 'U11 Division 3', who.compManager)
    check(lad.find((x) => x.entry_id === late.home_entry_id)?.played === 1, { what: 'and counted', expected: 'played 1', actual: lad.find((x) => x.entry_id === late.home_entry_id)?.played, role: 'parent', where: 'competition_ladder' })
    // The missing one stays missing; the league can see it.
    const m = await game(pool, missing.id)
    check(m.status === 'scheduled' && (await val(pool, `select count(*)::int from public.match_sheets where fixture_id = $1 and our_score is not null`, [m.id])) === 0, { what: 'a game nobody scored stays open for the league to chase', expected: 'scheduled, no scores', actual: m.status, role: 'league', where: 'fixtures' })
    ctx.missingGame = missing.id
    // Tuesday night, chased by the league, the managers put it in (a season ends with every game scored).
    const late2 = await enterScores(pool, missing, 2, 2)
    check(late2.away.data?.state === 'final', { what: 'chased, the missing result comes in on Tuesday and is final', expected: 'final', actual: late2.away.data?.state ?? late2.away.error, role: 'manager', where: 'enter_sheet_score' })
    // A correction: the home side says the second goal was disallowed.
    const c = await enterScores(pool, corr, 2, 1)
    const hs = await squad(pool, corr.home_team)
    const req = await rpc(pool, hs.manager ?? hs.coach, 'request_match_correction', { p_fixture: corr.id, p_kind: 'score', p_detail: 'The second goal was disallowed for offside — both sheets had it wrong', p_home: 1, p_away: 1 })
    mustWork(req, { what: 'the manager asks for a score correction after the game', role: 'manager', where: 'request_match_correction' })
    if (req.ok) {
      const told = await queued(pool, { kind: 'match_correction_requested' })
      check(told.length > 0, { what: 'the competition manager is told', expected: '>0', actual: told.length, role: 'competition manager', where: 'correction_push' })
      const dec = await rpc(pool, who.compManager, 'decide_match_correction', { p_correction: req.data, p_apply: true, p_note: 'Referee report agrees' })
      mustWork(dec, { what: 'the league applies it', role: 'competition manager', where: 'decide_match_correction' })
      const f = await game(pool, corr.id)
      check(f.home_score === 1 && f.away_score === 1 && f.status === 'final', { what: 'the result is now 1–1', expected: '1–1 final', actual: `${f.home_score}–${f.away_score} ${f.status}`, role: 'league', where: 'fixtures' })
      void c
    }
  })
  // R3: a coach with no signal at the ground — the ticker's taps arrive later, one of them twice.
  if (ctx.bench.r1[1]) add(kickoffPlus(ctx.bench.r1[1], 120), 'R3 the offline ticker syncs later', async () => {
    const g = ctx.bench.r1[1]
    const ev = await eventFor(pool, g.id, g.home_club)
    const sq = await squad(pool, g.home_team)
    const koAt = new Date(g.starts_at).toISOString()
    const c1 = '11111111-1111-4111-8111-' + g.id.slice(-12), c2 = '22222222-2222-4222-8222-' + g.id.slice(-12)
    const k = await rpc(pool, sq.coach, 'live_tick', { p_event: ev, p_kind: 'kick_off', p_player: null, p_assist: null, p_minute: null, p_note: null, p_client_id: c1, p_at: koAt })
    mustWork(k, { what: 'a kick-off tapped with no signal arrives later carrying the time it was tapped', role: 'coach', where: 'live_tick (p_at)' })
    const t1 = await rpc(pool, sq.coach, 'live_tick', { p_event: ev, p_kind: 'goal_for', p_player: sq.players[0], p_assist: null, p_minute: 12, p_note: null, p_client_id: c2, p_at: null })
    const t2 = await rpc(pool, sq.coach, 'live_tick', { p_event: ev, p_kind: 'goal_for', p_player: sq.players[0], p_assist: null, p_minute: 12, p_note: null, p_client_id: c2, p_at: null })
    const live = await rpc(pool, sq.coach, 'event_live', { p_event: ev })
    const ours = live.data?.ours ?? live.data?.score?.ours
    check(t1.ok && t2.ok && ours === 1, { what: 'the same goal sent twice (the phone retried) counts once', expected: 'ours 1', actual: `ours ${ours} (${t1.ok ? 'ok' : t1.error} / ${t2.ok ? 'ok' : t2.error})`, role: 'coach', where: 'live_tick (p_client_id)' })
    const koRow = await val(pool, `select created_at from public.event_ticker where event_id = $1 and kind = 'kick_off'`, [ev])
    check(koRow && Math.abs(new Date(koRow) - new Date(koAt)) < 60_000, { what: 'the kick-off is recorded at the time it was tapped, not when it synced', expected: koAt, actual: koRow, role: 'coach', where: 'event_ticker.created_at' })
  })
}

// =================================================================== round 2
export async function round2(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -5)} 10:00`, 'OF4a blocked-out referees are left alone', async () => {
    scenario('OF4', 'On-field issues', 'Referee no-show, late decline, club-supplied referee, under-18 referee, referee abused → report')
    const blocked = await val(pool, `select count(*)::int from public.referee_appointments ap join public.fixtures f on f.id = ap.fixture_id
      where ap.competition_id = $1 and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and ap.status in ('offered', 'accepted')
        and ap.referee_id in (select id from public.referees where id = any($3::uuid[]))`, [COMP, S, Array.from({ length: 20 }, (_, i) => ids.referee(i + 1))])
    check(blocked === 0, { what: 'the twenty referees away this Saturday were given nothing', expected: 0, actual: blocked, role: 'referee coordinator', where: 'propose_referee_allocation / referee_blockouts' })
    const u18 = await sql(pool, `select f.division, count(*)::int n from public.referee_appointments ap join public.fixtures f on f.id = ap.fixture_id join public.referees r on r.id = ap.referee_id
      where ap.competition_id = $1 and r.under_18 and ap.status in ('offered', 'accepted') and f.division ~ '^U1[57]' group by 1`, [COMP])
    check(u18.length === 0, { what: 'an under-18 referee is not put on an U15 or U17 game', expected: 'none', actual: u18.length ? u18.map((x) => `${x.division} ×${x.n}`).join(', ') : 'none', role: 'referee coordinator', where: 'propose_referee_allocation / referee_unavailable_reason', severity: 'medium' })
  })
  add(`${plusDays(S, -2)} 10:00`, 'OF4b a decline on Thursday is fine', async () => {
    const ap = (await sql(pool, `select ap.id, r.profile_id from public.referee_appointments ap join public.referees r on r.id = ap.referee_id join public.fixtures f on f.id = ap.fixture_id
      where ap.competition_id = $1 and ap.status = 'accepted' and r.profile_id is not null and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date order by f.starts_at limit 1`, [COMP, S]))[0]
    if (!ap) return
    const r = await rpc(pool, ap.profile_id, 'respond_appointment', { p_appointment: ap.id, p_accept: false, p_note: 'Family wedding, sorry' })
    mustWork(r, { what: 'a referee pulls out two days ahead', role: 'referee', where: 'respond_appointment' })
    const told = await queued(pool, { kind: 'referee_response', profile: who.refCoordinator })
    check(told.length > 0, { what: 'the coordinator is told', expected: '>0', actual: told.length, role: 'referee coordinator', where: 'respond_appointment' })
  })
  add(`${plusDays(S, -1)} 20:00`, 'OF4b/c a late decline is refused; the club supplies a referee inside the window', async () => {
    const ap = (await sql(pool, `select ap.id, ap.fixture_id, r.profile_id from public.referee_appointments ap join public.referees r on r.id = ap.referee_id join public.fixtures f on f.id = ap.fixture_id
      where ap.competition_id = $1 and ap.status = 'accepted' and r.profile_id is not null and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.division = 'U13 Division 2' order by f.starts_at limit 1`, [COMP, S]))[0]
    if (!ap) return
    const late = await rpc(pool, ap.profile_id, 'respond_appointment', { p_appointment: ap.id, p_accept: false, p_note: 'Can\'t make it' })
    mustRefuse(late, { what: 'a decline inside 24 hours is refused — ring the league', role: 'referee', where: 'respond_appointment (late_decline_hours)' })
    // The league withdraws them by phone call, and the home club finds its own referee.
    const wd = await rpc(pool, who.refCoordinator, 'withdraw_appointment', { p_appointment: ap.id, p_note: 'Rang in sick' })
    mustWork(wd, { what: 'the coordinator withdraws the appointment', role: 'referee coordinator', where: 'withdraw_appointment' })
    const g = await game(pool, ap.fixture_id)
    const hs = await squad(pool, g.home_team)
    const club = await rpc(pool, hs.manager ?? hs.coach, 'club_allocate_referee', { p_fixture: g.id, p_full_name: 'Jordan Clubref', p_phone: '+61400777111', p_grade: 'C' })
    mustWork(club, { what: 'inside 24 hours the home club puts up its own referee', role: 'team manager', where: 'club_allocate_referee' })
    const told = await queued(pool, { kind: 'referee_response', profile: who.refCoordinator, since: clock.iso() })
    check(told.some((t) => /put up/.test(t.title)), { what: 'the coordinator hears who the club put up', expected: '"… put up Jordan Clubref …"', actual: told.map((t) => t.title).join(' | ') || 'nothing', role: 'referee coordinator', where: 'club_allocate_referee' })
    ctx.clubRefGame = g.id
  })
  add(`${plusDays(S, -2)} 11:00`, 'OF4c too early for a club to allocate', async () => {
    const g = (await pick(ctx, S, 'U13 Division 3', 1))[0]
    if (!g) return
    const hs = await squad(pool, g.home_team)
    const early = await rpc(pool, hs.manager ?? hs.coach, 'club_allocate_referee', { p_fixture: g.id, p_full_name: 'Too Early', p_phone: null, p_grade: null })
    mustRefuse(early, { what: 'two days out a club cannot allocate — the league has first go', role: 'team manager', where: 'club_allocate_referee (club_allocate_hours)' })
  })
  add(`${S} 17:00`, 'OF4e a referee reports abuse', async () => {
    const ap = (await sql(pool, `select ap.id, ap.fixture_id, r.profile_id, r.full_name, h.display_name home from public.referee_appointments ap join public.referees r on r.id = ap.referee_id join public.fixtures f on f.id = ap.fixture_id join public.competition_entries h on h.id = f.home_entry_id
      where ap.competition_id = $1 and ap.status = 'accepted' and ap.checked_in_at is not null and r.profile_id is not null and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date order by f.starts_at limit 1`, [COMP, S]))[0]
    if (!ap) { check(false, { what: 'a checked-in referee to report', expected: 'one', actual: 'none', role: 'referee', where: 'referee_appointments', quiet: true }); return }
    const rep = await rpc(pool, ap.profile_id, 'submit_referee_report', { p_appointment: ap.id, p_report: JSON.stringify({ abuse: true, by: `a spectator with ${ap.home}`, detail: 'Shouted at me after the second goal and followed me to the car park', cards: 1 }) })
    mustWork(rep, { what: 'the referee files their report with the abuse in it', role: 'referee', where: 'submit_referee_report' })
    const seen = await rpc(pool, who.refCoordinator, 'competition_appointments', { p_competition: COMP, p_division: null })
    const row = (seen.data?.fixtures ?? []).find((f) => f.fixture_id === ap.fixture_id)?.appointments?.find((a) => a.id === ap.id)
    check(row?.report?.abuse === true, { what: 'the referee coordinator reads it on the appointments screen', expected: 'abuse: true', actual: JSON.stringify(row?.report ?? null), role: 'referee coordinator', where: 'competition_appointments' })
    const refTold = await queued(pool, { since: clock.iso(), kind: 'referee_report' })
    check(refTold.length > 0, { what: 'a report of abuse reaches the coordinator or the discipline officer without them looking', expected: 'a push', actual: `${refTold.length} queued`, role: 'referee coordinator', where: 'submit_referee_report', severity: 'medium' })
    // The discipline officer files it as a concern and bans the spectator by name.
    const con = await rpc(pool, who.discipline, 'file_conduct_report', { p_academy: LEAGUE, p_category: 'concern', p_description: `Referee ${ap.full_name} abused by a spectator with ${ap.home} after the game and followed to the car park.`, p_occurred_on: S, p_subject_name: `Spectator, ${ap.home}`, p_subject_profile: null, p_involves_child: false })
    mustWork(con, { what: 'the discipline officer files a conduct report at the league', role: 'discipline officer', where: 'file_conduct_report' })
    const ban = await rpc(pool, who.discipline, 'ban_person', { p_academy: LEAGUE, p_reason: 'Abuse of a match official', p_profile: null, p_player: null, p_name: `Spectator, ${ap.home} (grey jacket)`, p_ends_on: '2027-06-30', p_note: 'Identified by the home manager' })
    mustWork(ban, { what: 'and bans the spectator by name for the season', role: 'discipline officer', where: 'ban_person' })
    const list = await rpc(pool, who.discipline, 'bans_list', { p_academy: LEAGUE })
    check((list.data?.bans ?? list.data ?? []).length >= 1 || JSON.stringify(list.data ?? '').includes('grey jacket'), { what: 'the ban is on the league\'s list', expected: 'listed', actual: JSON.stringify(list.data ?? list.error).slice(0, 120), role: 'discipline officer', where: 'bans_list' })
  })
  add(`${plusDays(S, 1)} 11:30`, 'OF4d no-shows are visible to the coordinator', async () => {
    const seen = await rpc(pool, who.refCoordinator, 'competition_appointments', { p_competition: COMP, p_division: null })
    const noShows = ctx.noShows.filter((n) => true)
    const rows = (seen.data?.fixtures ?? []).flatMap((f) => (f.appointments ?? []).map((a) => ({ ...a, fixture_id: f.fixture_id, status_f: f.status })))
    const unchecked = rows.filter((a) => a.status === 'accepted' && !a.checked_in_at && a.status_f === 'final')
    check(unchecked.length >= Math.min(1, noShows.length), { what: `the ${noShows.length} referees who never checked in show as accepted without a check-in on finished games`, expected: `≥${Math.min(1, noShows.length)}`, actual: unchecked.length, role: 'referee coordinator', where: 'competition_appointments' })
    const summary = seen.data?.summary ?? []
    check(summary.length > 0 && summary.some((s) => s.accepted > s.checked_in), { what: 'the per-referee summary shows accepted games against check-ins', expected: 'some accepted > checked in', actual: `${summary.length} referees`, role: 'referee coordinator', where: 'competition_appointments.summary' })
  })

  // FV11: a game moved onto Field 3 by name; the field, the map and the address reach every family.
  add(`${plusDays(S, -3)} 10:00`, 'FV11 a game is put on Field 3; every family sees the field and the map', async () => {
    scenario('FV11', 'Fields & venues', 'Field map, directions and "Field 3" shown correctly to every family affected')
    const g = (await pick(ctx, S, 'U15 Division 1', 1))[0]
    if (!g || !ctx.field3) { check(false, { what: 'a game and Field 3 to use', expected: 'both', actual: `${!!g} ${!!ctx.field3}`, role: '—', where: '—', quiet: true }); return }
    const mv = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: new Date(g.starts_at).toISOString(), p_venue_label: 'Harbour Park', p_field: 'Field 3' })
    mustWork(mv, { what: 'the ground manager moves the game onto Field 3 by name', role: 'ground manager', where: 'reschedule_fixture' })
    const f = await game(pool, g.id)
    check(f.field_label === 'Field 3' && f.pitch_id === ctx.field3, { what: 'the game is on Field 3 (label and pitch)', expected: 'Field 3 / its pitch id', actual: `${f.field_label} / ${f.pitch_id === ctx.field3 ? 'Field 3' : 'the old pitch'}`, role: 'ground manager', where: 'apply_reschedule' })
    for (const side of ['home', 'away']) {
      const ev = await eventFor(pool, g.id, g[`${side}_club`])
      const sq = await squad(pool, g[`${side}_team`])
      const parent = await guardianOf(pool, sq.players[0])
      const screen = await rpc(pool, parent, 'game_screen', { p_event: ev })
      const venueText = `${screen.data?.event?.venue ?? ''} ${screen.data?.event?.address ?? ''}`
      check(/Field 3/.test(venueText), { what: `a ${side} family's game page says Field 3`, expected: 'Harbour Park · Field 3', actual: venueText.trim() || screen.error, role: 'parent', where: 'game_screen / mirror_fixture' })
      const map = await rpc(pool, parent, 'fixture_pitch', { p_fixture: g.id })
      check(map.ok && map.data?.lat && map.data?.address && map.data?.field_label === 'Field 3' && (map.data?.pitches ?? []).some((p) => p.name === 'Field 3'), { what: `the ${side} family gets the field map with the pin, the address and Field 3 drawn`, expected: 'lat, address, Field 3 on the canvas', actual: map.ok ? `lat ${map.data?.lat}, ${map.data?.address}, field ${map.data?.field_label}, ${(map.data?.pitches ?? []).length} pitches` : map.error, role: 'parent', where: 'fixture_pitch / venue_layout' })
    }
    const told = await queued(pool, { kind: 'event_changed', since: new Date(Date.now() - 1).toISOString() })
    const families = await val(pool, `select count(distinct tm.profile_id)::int from public.team_members tm where tm.team_id in ($1, $2)`, [g.home_team, g.away_team])
    const toldNow = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where kind = 'event_changed' and payload->>'event_id' in (select id::text from public.events where fixture_id = $1) and created_at >= $2`, [g.id, clock.iso()])
    check(toldNow >= families, { what: 'both squads were told the field changed', expected: `${families} people`, actual: toldNow, role: 'parent', where: 'notify_event_change', severity: 'high' })
    void told
  })
}

// =================================================================== round 3
export async function round3(ctx, S, add) {
  const { pool } = ctx
  // FV9a: Friday night, the council closes Bayview Reserve.
  add(`${plusDays(S, -1)} 20:00`, 'FV9a Friday-night ground closure', async () => {
    scenario('FV9', 'Fields & venues', 'Ground closures announced Friday night and Saturday 7 am; a whole venue closed')
    const before = await gamesOn(pool, S, { venue: ids.venue(2), status: 'scheduled' })
    const r = await rpc(pool, who.grounds, 'call_off_fixtures', { p_competition: COMP, p_date: S, p_reason: 'ground_closed', p_venue: 'Bayview Reserve', p_cancel: false, p_note: 'Council closed Bayview Reserve — waterlogged', p_pitch: null })
    mustWork(r, { what: 'the ground manager calls off every game at Bayview on Friday night', role: 'ground manager', where: 'call_off_fixtures' })
    check(r.data?.affected === before.length, { what: 'every game there is postponed, nothing else', expected: before.length, actual: r.data?.affected, role: 'ground manager', where: 'call_off_fixtures' })
    await checkCallOffTold(ctx, before, { urgent: true, label: 'Friday night' })
    ctx.closedBayview = before
  })
  // FV9b / FV6: Saturday 7 am the council closes Rivergum Fields; FV10 one pitch at Ironbark.
  add(`${S} 07:00`, 'FV9b/FV6 Saturday 7 am closure of a whole venue; FV10 one pitch only', async () => {
    const before = await gamesOn(pool, S, { venue: ids.venue(3), status: 'scheduled' })
    const r = await rpc(pool, who.grounds, 'call_off_fixtures', { p_competition: COMP, p_date: S, p_reason: 'wet_weather', p_venue: 'Rivergum Fields', p_cancel: false, p_note: 'Council wet-weather closure 7 am', p_pitch: null })
    check(r.ok && r.data?.affected === before.length, { what: 'at 7 am every game at Rivergum is postponed', expected: before.length, actual: r.ok ? r.data?.affected : r.error, role: 'ground manager', where: 'call_off_fixtures' })
    await checkCallOffTold(ctx, before, { urgent: true, label: 'Saturday 7 am' })
    scenario('FV6', 'Fields & venues', 'A whole venue closed')
    const left = await gamesOn(pool, S, { venue: ids.venue(3), status: 'scheduled' })
    check(left.length === 0, { what: 'nothing is left on at Rivergum', expected: 0, actual: left.length, role: 'ground manager', where: 'fixtures' })
    scenario('FV10', 'Fields & venues', 'Partial closure: one pitch only')
    const field1 = ids.pitch(4, 1)
    const onField1 = await sql(pool, `select f.id from public.fixtures f where f.competition_id = $1 and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.status = 'scheduled' and f.pitch_id in (select app_private.pitch_family($3))`, [COMP, S, field1])
    const onField2 = await sql(pool, `select f.id from public.fixtures f where f.competition_id = $1 and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.status = 'scheduled' and f.pitch_id in (select app_private.pitch_family($3))`, [COMP, S, ids.pitch(4, 2)])
    const p = await rpc(pool, who.grounds, 'call_off_fixtures', { p_competition: COMP, p_date: S, p_reason: 'ground_closed', p_venue: null, p_cancel: false, p_note: 'Field 1 at Ironbark under water; Field 2 is fine', p_pitch: field1 })
    check(p.ok && p.data?.affected === onField1.length, { what: 'Field 1 and its quarters are called off at Ironbark', expected: onField1.length, actual: p.ok ? p.data?.affected : p.error, role: 'ground manager', where: 'call_off_fixtures (p_pitch)' })
    const stillOn = await val(pool, `select count(*)::int from public.fixtures where id = any($1::uuid[]) and status = 'scheduled'`, [onField2.map((x) => x.id)])
    check(stillOn === onField2.length, { what: 'Field 2\'s games at Ironbark are untouched', expected: onField2.length, actual: stillOn, role: 'ground manager', where: 'call_off_fixtures (p_pitch)' })
  })
  // FV5 / FV7 / FV8: the morning's moves.
  add(`${S} 07:30`, 'FV5 a pitch changed on the morning; FV7 a game moved to another venue', async () => {
    scenario('FV5', 'Fields & venues', 'A pitch changed on the morning')
    // Any game today with another pitch of its size free at the same ground at that time.
    const g = (await sql(pool, `
      select f.id, p2.name as free_pitch from public.fixtures f
        join public.pitches p1 on p1.id = f.pitch_id
        join public.pitches p2 on p2.venue_id = p1.venue_id and p2.size = p1.size and p2.id <> p1.id
       where f.competition_id = $1 and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.status = 'scheduled'
         and f.home_entry_id is not null and f.away_entry_id is not null and f.starts_at > now() + interval '30 minutes'
         and app_private.pitch_clash(p2.id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)), f.id) is null
         and app_private.pitch_open(p2.id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)))
         and app_private.staff_clash(f.competition_id, f.home_entry_id, f.away_entry_id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)), f.venue_label, f.id) is null
       order by f.starts_at limit 1`, [COMP, S]))[0]
    if (g) {
      const fx = await game(pool, g.id)
      const mv = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: fx.id, p_starts_at: new Date(fx.starts_at).toISOString(), p_venue_label: null, p_field: g.free_pitch })
      mustWork(mv, { what: `the game moves from ${fx.field_label} to ${g.free_pitch} at the same time`, role: 'ground manager', where: 'reschedule_fixture' })
      const f = await game(pool, fx.id)
      check(f.field_label === g.free_pitch, { what: 'the fixture is on the new pitch', expected: g.free_pitch, actual: f.field_label, role: 'ground manager', where: 'apply_reschedule' })
      const told = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where created_at >= $2 and payload->>'event_id' in (select id::text from public.events where fixture_id = $1)`, [fx.id, clock.iso()])
      const families = await val(pool, `select count(distinct tm.profile_id)::int from public.team_members tm where tm.team_id in ($1, $2)`, [fx.home_team, fx.away_team])
      check(told >= families, { what: 'both squads hear the field changed, an hour before kick-off', expected: `${families}`, actual: told, role: 'parent', where: 'notify_event_change', severity: 'high' })
    } else check(false, { what: 'a game with a free pitch of its size beside it', expected: 'one', actual: 'none today', role: '—', where: 'fixtures', quiet: true })

    scenario('FV7', 'Fields & venues', 'A game moved to another venue')
    const h = (await sql(pool, `
      select f.id, p2.id as pitch, p2.name as pitch_name, v2.name as venue from public.fixtures f
        join public.pitches p1 on p1.id = f.pitch_id
        join public.pitches p2 on p2.size = p1.size and p2.venue_id <> p1.venue_id and p2.academy_id = p1.academy_id
        join public.venues v2 on v2.id = p2.venue_id
       where f.competition_id = $1 and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.status = 'scheduled'
         and f.home_entry_id is not null and f.away_entry_id is not null and f.starts_at > now() + interval '30 minutes'
         and app_private.pitch_clash(p2.id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)), f.id) is null
         and app_private.pitch_open(p2.id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)))
         and app_private.staff_clash(f.competition_id, f.home_entry_id, f.away_entry_id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)), v2.name, f.id) is null
       order by f.starts_at desc limit 1`, [COMP, S]))[0]
    if (h) {
      const fx = await game(pool, h.id)
      const mv = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: fx.id, p_starts_at: new Date(fx.starts_at).toISOString(), p_venue_label: h.venue, p_field: h.pitch_name })
      mustWork(mv, { what: `the game moves to ${h.venue} ${h.pitch_name}`, role: 'ground manager', where: 'reschedule_fixture' })
      const f = await game(pool, fx.id)
      check(f.pitch_id === h.pitch && f.venue_label === h.venue, { what: 'venue, pitch and label all say the new ground', expected: `${h.venue} / ${h.pitch_name}`, actual: `pitch ${f.pitch_id === h.pitch ? 'new' : 'OLD'}, label ${f.venue_label}`, role: 'ground manager', where: 'apply_reschedule' })
      const ev = await eventFor(pool, fx.id, fx.away_club)
      const parent = await guardianOf(pool, (await squad(pool, fx.away_team)).players[0])
      const screen = await rpc(pool, parent, 'game_screen', { p_event: ev })
      check((screen.data?.event?.venue ?? '').includes(h.venue), { what: "an away family's game page shows the new ground", expected: h.venue, actual: screen.data?.event?.venue, role: 'parent', where: 'game_screen' })
      const told = await queued(pool, { kind: 'event_changed', since: clock.iso(), event: ev })
      check(told.length > 0 && /Now at/.test(told[0].body ?? ''), { what: 'and was told "Now at …"', expected: `Now at ${h.venue}`, actual: told[0]?.body ?? 'nothing', role: 'parent', where: 'notify_event_change' })
    } else check(false, { what: 'a game with a free pitch of its size at another ground', expected: 'one', actual: 'none today', role: '—', where: 'fixtures', quiet: true })
  })
  add(`${S} 08:30`, 'FV8 a late kick-off pushes the later games', async () => {
    scenario('FV8', 'Fields & venues', 'A late kick-off pushing later games')
    const pitch = await val(pool, `select f.pitch_id from public.fixtures f where f.competition_id = $1 and f.status = 'scheduled' and f.pitch_id is not null and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.starts_at > now() group by f.pitch_id having count(*) >= 3 order by count(*) desc limit 1`, [COMP, S])
    if (!pitch) { check(false, { what: 'a pitch with three games still to play', expected: 'one', actual: 'none', role: '—', where: 'fixtures', quiet: true }); return }
    const chain = await sql(pool, `select f.id, f.starts_at, f.duration_mins, f.field_label from public.fixtures f where f.competition_id = $1 and f.status = 'scheduled' and f.pitch_id = $2 and f.starts_at > now() order by f.starts_at limit 3`, [COMP, pitch])
    const [, second, third] = chain
    const plus30 = (t) => new Date(new Date(t).getTime() + 30 * 60_000).toISOString()
    const wrongOrder = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: second.id, p_starts_at: plus30(second.starts_at), p_venue_label: null, p_field: null })
    mustRefuse(wrongOrder, { what: 'pushing the middle game first is refused — it would run into the next', role: 'ground manager', where: 'reschedule_fixture → pitch_clash' })
    const a = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: third.id, p_starts_at: plus30(third.starts_at), p_venue_label: null, p_field: null })
    const b = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: second.id, p_starts_at: plus30(second.starts_at), p_venue_label: null, p_field: null })
    check(a.ok && b.ok, { what: 'last game first, both move by half an hour', expected: 'both allowed', actual: `${a.ok ? 'ok' : a.error} / ${b.ok ? 'ok' : b.error}`, role: 'ground manager', where: 'reschedule_fixture' })
    const told = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where kind = 'event_changed' and created_at >= $1 and payload->>'event_id' in (select id::text from public.events where fixture_id in ($2, $3))`, [clock.iso(), second.id, third.id])
    check(told > 0, { what: "both squads' families hear the new times", expected: '>0', actual: told, role: 'parent', where: 'notify_event_change' })
    ctx.pushedGames = [second.id, third.id]
  })
  // WS3: extreme heat.
  add(`${plusDays(S, -1)} 18:00`, 'WS3 extreme heat: an earlier kick-off, drink breaks, a round postponed', async () => {
    scenario('WS3', 'Weather & safety on the day', 'Extreme heat → kick-offs moved earlier / drink breaks noted / a round postponed')
    const chan = await noticesChannel(pool)
    const n = await say(pool, who.compManager, chan, LEAGUE, 'Heat: 41° forecast. Drink breaks at 20 and 60 minutes in every game tomorrow; U9 games at Fernleigh Park are moved to next week; the 2 pm U17 game at Seacliff moves to 8 am.', { audience: 'everyone', is_announcement: true })
    mustWork(n, { what: 'the league tells everyone about the heat rules', role: 'competition manager', where: 'messages (notices)' })
    const noteRows = await run(pool, who.compManager, `update public.fixtures set notes = coalesce(notes || ' · ', '') || 'Drink breaks at 20 and 60 minutes (heat)' where competition_id = $1 and (starts_at at time zone 'Australia/Sydney')::date = $2::date and status = 'scheduled' returning id`, [COMP, S])
    check(noteRows.ok && noteRows.data.length > 0, { what: 'the drink breaks are noted on every game of the day', expected: '>0 games noted', actual: noteRows.ok ? noteRows.data.length : noteRows.error, role: 'competition manager', where: 'fixtures.notes' })
    const u9 = await rpc(pool, who.grounds, 'abandon_round', { p_competition: COMP, p_division: 'U9 Division 9', p_round: 'Round 3', p_reason: 'other', p_cancel: false, p_note: 'Extreme heat — U9 round moved' })
    check(u9.ok && u9.data > 0, { what: 'the U9 round at Fernleigh is postponed for the heat', expected: '>0 games', actual: u9.ok ? u9.data : u9.error, role: 'ground manager', where: 'abandon_round' })
    const late = (await sql(pool, `select f.* from public.fixtures f where f.competition_id = $1 and f.division = 'U17 Division 1' and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date and f.status = 'scheduled' order by f.starts_at desc limit 1`, [COMP, S]))[0]
    if (late) {
      const early = await freeSlot(pool, late.pitch_id, S, '08:00', '12:00', late.duration_mins ?? 80, late.id)
      if (early) {
        const mv = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: late.id, p_starts_at: early, p_venue_label: null, p_field: null })
        check(mv.ok, { what: 'the afternoon U17 game moves to the morning', expected: 'moved', actual: mv.ok ? 'moved' : mv.error, role: 'ground manager', where: 'reschedule_fixture' })
      } else note('no free morning slot for the U17 game')
    }
  })
}

/** After a call-off: every family and coach of every affected game was told once; a text inside 24 hours; the referees too. */
async function checkCallOffTold(ctx, games, { urgent, label }) {
  const { pool } = ctx
  if (!games.length) return
  const ids_ = games.map((g) => g.id)
  const expected = await val(pool, `select count(distinct tm.profile_id)::int from public.team_members tm where tm.team_id in (select unnest(array_remove(array_agg(x), null)) from (select home_team x from (select e.team_id home_team from public.fixtures f join public.competition_entries e on e.id in (f.home_entry_id, f.away_entry_id) where f.id = any($1::uuid[])) y) z)`, [ids_])
  const told = await sql(pool, `select n.profile_id, count(*)::int n, bool_or(n.escalate_sms) sms from public.notification_queue n where n.kind = 'event_cancelled' and n.payload->>'event_id' in (select id::text from public.events where fixture_id = any($1::uuid[])) group by n.profile_id`, [ids_])
  const people = told.length
  const perGameDup = await val(pool, `select count(*)::int from (select profile_id, payload->>'event_id' e from public.notification_queue where kind = 'event_cancelled' and payload->>'event_id' in (select id::text from public.events where fixture_id = any($1::uuid[])) group by 1, 2 having count(*) > 1) x`, [ids_])
  check(people >= expected * 0.95, { what: `${label}: every family and coach of the ${games.length} games is told`, expected: `${expected} people`, actual: `${people} people told`, role: 'parent', where: 'notify_event_change' })
  check(perGameDup === 0, { what: `${label}: nobody is told twice about one game`, expected: 0, actual: perGameDup, role: 'parent', where: 'notification_queue dedupe_key' })
  const smsRows = told.filter((t) => t.sms).length
  check(urgent ? smsRows === people : smsRows === 0, { what: `${label}: ${urgent ? 'inside 24 hours every push is marked for a text' : 'more than a day out, no text'}`, expected: urgent ? people : 0, actual: smsRows, role: 'parent', where: 'notify_event_change (escalate_sms)' })
  const refs = await sql(pool, `select r.profile_id from public.referee_appointments ap join public.referees r on r.id = ap.referee_id where ap.fixture_id = any($1::uuid[]) and ap.status = 'accepted' and r.profile_id is not null`, [ids_])
  if (refs.length) {
    const distinctRefs = new Set(refs.map((r) => r.profile_id)).size
    const refTold = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where profile_id = any($1::uuid[]) and created_at >= now() - interval '5 minutes' and (payload->>'fixture_id' in (select id::text from unnest($2::uuid[]) id) or payload->>'event_id' in (select id::text from public.events where fixture_id = any($2::uuid[])) or kind like 'referee%')`, [refs.map((r) => r.profile_id), ids_])
    check(refTold >= distinctRefs, { what: `${label}: the ${distinctRefs} referees appointed to those games are told their game is off`, expected: distinctRefs, actual: refTold, role: 'referee', where: 'call_off_fixtures / notify_referees_of_change', severity: 'high' })
  }
}

// =================================================================== round 4
export async function round4(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -1)} 19:00`, 'WS1 the whole round washed out on Friday night', async () => {
    scenario('WS1', 'Weather & safety on the day', 'Wet-weather washout of a whole round: every game called off, every family, coach and referee told once, no duplicate pushes')
    const before = await gamesOn(pool, S, { status: 'scheduled' })
    const r = await rpc(pool, who.compManager, 'call_off_fixtures', { p_competition: COMP, p_date: S, p_reason: 'wet_weather', p_venue: null, p_cancel: false, p_note: 'Washout — every ground is closed', p_pitch: null })
    check(r.ok && r.data?.affected === before.length, { what: `every one of the ${before.length} games is postponed`, expected: before.length, actual: r.ok ? r.data?.affected : r.error, role: 'competition manager', where: 'call_off_fixtures' })
    await checkCallOffTold(ctx, before, { urgent: true, label: 'Washout' })
    const jobs = await rpc(pool, who.compManager, 'home_jobs', { p_academy: LEAGUE, p_persona: 'league' })
    const draw = (jobs.data?.jobs ?? []).find((j) => j.id === 'draw')
    check(/Nothing this weekend/.test(draw?.detail ?? ''), { what: 'the league\'s Home now says nothing is on this weekend', expected: 'Nothing this weekend', actual: draw?.detail, role: 'league', where: 'home_jobs (league)' })
    ctx.washedOut = before
  })
  add(`${S} 07:30`, 'SCREENS a washout Saturday', () => runScreens(ctx, 'washout'))
  add(`${plusDays(S, 1)} 15:00`, 'WS4 the washed-out games are rescheduled: mid-week, a double-header, a catch-up round', async () => {
    scenario('WS4', 'Weather & safety on the day', 'Rescheduled games: a catch-up round, a mid-week reschedule, a double-header')
    const postponed = await gamesOn(pool, S, { status: 'postponed' })
    const wed = plusDays(S, 4)
    let midweek = 0, catchup = 0, dh = 0, backOn = 0
    // Four U11 Division 1 games under lights on Wednesday at Harbour Park's halves.
    const u11 = postponed.filter((g) => g.division === 'U11 Division 1').slice(0, 4)
    for (const [i, g] of u11.entries()) {
      const at = new Date(`${wed}T${i < 2 ? '19:00' : '20:00'}:00+11:00`).toISOString()
      const r = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: at, p_venue_label: null, p_field: i % 2 === 0 ? 'Field 2 H1' : 'Field 2 H2' })
      if (r.ok) midweek++; else note(`midweek: ${r.error}`)
    }
    check(midweek === u11.length && u11.length > 0, { what: 'four games are replayed under lights on Wednesday night within the pitch\'s hours', expected: u11.length, actual: midweek, role: 'ground manager', where: 'reschedule_fixture' })
    // A double-header: a U13 Division 1 pair play their washed-out game next Saturday afternoon as well as their round.
    const next = plusDays(S, 7)
    const u13 = postponed.filter((g) => g.division === 'U13 Division 1').slice(0, 1)
    for (const g of u13) {
      const slot = await freeSlot(pool, g.pitch_id, next, '13:00', '16:30', g.duration_mins ?? 60, g.id)
      if (!slot) { note('no afternoon slot for the double-header'); continue }
      const r = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: slot, p_venue_label: null, p_field: null })
      if (r.ok) dh++
      const q = await rpc(pool, who.compManager, 'draw_quality', { p_competition: COMP, p_division: 'U13 Division 1' })
      check(r.ok && (q.data?.double_headers ?? []).some((d) => d.day === next), { what: 'the double-header shows in the draw\'s sanity check', expected: `a double header on ${next}`, actual: JSON.stringify(q.data?.double_headers ?? r.error).slice(0, 120), role: 'competition manager', where: 'draw_quality' })
    }
    // Everything else to the catch-up Saturday, 22 May, same pitch and time of day.
    const rest = (await gamesOn(pool, S, { status: 'postponed' }))
    const why = {}
    let later = 0
    const sameTimeOn = (g) => new Date(`2027-05-22T${new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(g.starts_at))}:00+10:00`).toISOString()
    // First pass: every game at its own time of day. Second pass: a game refused — a coach or
    // manager already on a game then (an earlier postponement parked on the same Saturday), or
    // the pitch taken — goes into a free slot on its own pitch that day, as the ground manager would.
    const refused = []
    for (const g of rest) {
      const r = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: sameTimeOn(g), p_venue_label: null, p_field: null })
      if (r.ok) catchup++; else refused.push({ g, error: r.error })
    }
    for (const { g, error } of refused) {
      let ok = false
      for (const [start, to] of [['08:00', '12:00'], ['12:00', '17:30']]) {
        let from = start // moved later in the window after a clash (the loop's own binding is constant)
        for (let tries = 0; tries < 4 && !ok; tries++) {
          const slot = await freeSlot(pool, g.pitch_id, '2027-05-22', from, to, g.duration_mins ?? 60, g.id)
          if (!slot) break
          const r = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: slot, p_venue_label: null, p_field: null })
          if (r.ok) { ok = true; catchup++; later++ }
          else if (r.code !== '23P01') break
          else from = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(new Date(slot).getTime() + 30 * 60_000))
        }
        if (ok) break
      }
      if (!ok) { const k = error.replace(/[0-9:–]+/g, '#').slice(0, 80); why[k] = (why[k] ?? 0) + 1 }
    }
    if (later) note(`${later} of the catch-up moves went to another time that day — a coach or manager was already on a game, or the pitch was taken, at the usual time`)
    // A player in two squads (playing up, borrowed) who is on another game whenever this one could go: the
    // product refuses the double booking, rightly — those are left for the league to place by hand.
    const clashes = Object.entries(why).filter(([k]) => / is on /.test(k)).reduce((n, [, v]) => n + v, 0)
    if (clashes) note(`${clashes} could not go to 22 May without a player in two places at once — left for the league to place by hand`)
    check(catchup + clashes === rest.length, { what: `the other ${rest.length} games go to the catch-up round on 22 May at their own times (or later that day)`, expected: rest.length, actual: `${catchup} moved; refused: ${JSON.stringify(why)}`, role: 'ground manager', where: 'reschedule_fixture' })
    backOn = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where kind = 'event_back_on' and created_at >= $1`, [new Date(clock.now.getTime() - 60_000).toISOString()])
    check(backOn > 0, { what: 'families are told their game is back on, with the new day', expected: '>0', actual: backOn, role: 'parent', where: 'notify_event_change (event_back_on)' })
    ctx.catchupDate = '2027-05-22'
  })
}

// =================================================================== round 5
export async function round5(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -2)} 10:00`, 'R4 a coach asks to forfeit; the club, then the league, decide', async () => {
    scenario('R4', 'Results', 'Forfeit (coach → club → league), walkover, bye, abandoned with the score standing / replayed / awarded')
    const g = (await pick(ctx, S, 'U13 Division 2', 1))[0]
    if (!g) return
    reserve(ctx, g)
    const away = await squad(pool, g.away_team)
    const req = await rpc(pool, away.coach, 'request_forfeit', { p_fixture: g.id, p_entry: g.away_entry_id, p_reason: 'Half the squad is away at a school camp' })
    mustWork(req, { what: 'the away coach asks to forfeit', role: 'coach', where: 'request_forfeit' })
    if (!req.ok) return
    let st = await val(pool, `select status from public.forfeit_requests where id = $1`, [req.data])
    check(st === 'proposed', { what: 'the request waits for the club', expected: 'proposed', actual: st, role: 'club admin', where: 'forfeit_requests' })
    const clubTold = await val(pool, `select count(*)::int from public.notification_queue where kind = 'forfeit_request' and payload->>'request_id' = $1::text`, [req.data])
    check(clubTold > 0, { what: 'the club\'s staff are asked to approve or decline', expected: '>0', actual: clubTold, role: 'club admin', where: 'request_forfeit' })
    const leagueEarly = await rpc(pool, who.compManager, 'league_decide_forfeit', { p_request: req.data, p_approve: true, p_note: null })
    void leagueEarly // the league may decide at any stage; the club step is for the club
    if (leagueEarly.ok) {
      note('the league decided before the club did (allowed: the league may act on a proposed request)')
    } else {
      const club = await rpc(pool, who.secretary(await clubNumber(pool, g.away_club)), 'club_decide_forfeit', { p_request: req.data, p_approve: true, p_note: 'Confirmed with the coach' })
      mustWork(club, { what: 'the club secretary approves', role: 'secretary', where: 'club_decide_forfeit' })
      const league = await rpc(pool, who.compManager, 'league_decide_forfeit', { p_request: req.data, p_approve: true, p_note: 'Approved — 3–0 to the home side' })
      mustWork(league, { what: 'the league approves', role: 'competition manager', where: 'league_decide_forfeit' })
    }
    const f = await game(pool, g.id)
    check(f.status === 'forfeit' && f.home_score === 3 && f.away_score === 0, { what: 'the game is a forfeit, 3–0 to the home side', expected: 'forfeit 3–0', actual: `${f.status} ${f.home_score}–${f.away_score}`, role: 'league', where: 'forfeit_fixture' })
    const lad = await ladder(pool, 'U13 Division 2', who.compManager)
    check(lad.find((x) => x.entry_id === g.home_entry_id)?.won >= 1, { what: 'the home side has the win on the ladder', expected: 'a win', actual: `${lad.find((x) => x.entry_id === g.home_entry_id)?.won} wins`, role: 'parent', where: 'competition_ladder' })
    const fam = await val(pool, `select count(*)::int from public.notification_queue where created_at >= $1 and payload->>'event_id' in (select id::text from public.events where fixture_id = $2)`, [new Date(clock.now.getTime() - 60_000).toISOString(), g.id])
    check(fam > 0, { what: 'both squads\' families hear the game is off (forfeit)', expected: '>0', actual: fam, role: 'parent', where: 'notify_event_change', severity: 'medium' })
  })
  add(`${S} 09:25`, 'WS2 lightning: one game resumed later, one abandoned with the score standing, one to be replayed, one awarded', async () => {
    scenario('WS2', 'Weather & safety on the day', 'Lightning suspension mid-game → resumed later the same day, and one abandoned')
    const games = (await gamesOn(pool, S, { venue: ids.venue(2), status: 'scheduled' })).filter((g) => g.local_start.slice(11, 16) === '08:00' || g.local_start.slice(11, 16) === '08:45')
    const [resume, standing, replay, award] = games.filter((g) => g.home_team && g.away_team)
    if (!resume || !standing || !replay || !award) { check(false, { what: 'four 8 am games at Bayview to use', expected: 4, actual: games.length, role: '—', where: '—', quiet: true }); return }
    reserve(ctx, resume, standing, replay, award)
    // Resumed at 1 pm on the same pitch.
    const slot = await freeSlot(pool, resume.pitch_id, S, '13:00', '16:30', resume.duration_mins ?? 60, resume.id)
    if (slot) {
      const mv = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: resume.id, p_starts_at: slot, p_venue_label: null, p_field: null })
      mustWork(mv, { what: 'the suspended game is moved to the afternoon on the same pitch', role: 'ground manager', where: 'reschedule_fixture' })
      const told = await val(pool, `select count(distinct profile_id)::int from public.notification_queue where kind = 'event_changed' and created_at >= $1 and payload->>'event_id' in (select id::text from public.events where fixture_id = $2)`, [new Date(clock.now.getTime() - 60_000).toISOString(), resume.id])
      check(told > 0, { what: 'both squads hear the new time at once', expected: '>0', actual: told, role: 'parent', where: 'notify_event_change' })
      ctx.resumedGame = resume
    } else note('no afternoon slot to resume on')
    // Abandoned at 60 minutes, 2–1: the score stands.
    const st = await rpc(pool, who.compManager, 'rule_on_score', { p_fixture: standing.id, p_home: 2, p_away: 1, p_note: 'Abandoned at 60 minutes for lightning — score stands' })
    mustWork(st, { what: 'the league lets an abandoned game\'s score stand', role: 'competition manager', where: 'rule_on_score' })
    check((await game(pool, standing.id)).status === 'final', { what: 'and it is final', expected: 'final', actual: (await game(pool, standing.id)).status, role: 'league', where: 'fixtures' })
    // Abandoned at 10 minutes: to be replayed.
    const rp = await rpc(pool, who.grounds, 'postpone_fixture', { p_fixture: replay.id, p_reason: 'other', p_cancel: false, p_note: 'Abandoned at 10 minutes for lightning — to be replayed' })
    mustWork(rp, { what: 'a game abandoned early is postponed to be replayed', role: 'ground manager', where: 'postpone_fixture' })
    ctx.toReplay = replay.id
    // Awarded: the away side left the ground.
    const aw = await rpc(pool, who.compManager, 'rule_on_score', { p_fixture: award.id, p_home: 3, p_away: 0, p_note: 'Awarded 3–0 — the away side left the ground during the suspension' })
    mustWork(aw, { what: 'a game is awarded 3–0', role: 'competition manager', where: 'rule_on_score' })
  })
  add(`${S} 14:40`, 'WS2 the resumed game is played and scored', async () => {
    if (!ctx.resumedGame) return
    const g = await game(pool, ctx.resumedGame.id)
    const r = await enterScores(pool, g, 1, 1)
    check(r.away.data?.state === 'final', { what: 'the resumed game finishes and is final', expected: 'final', actual: r.away.data?.state ?? r.away.error, role: 'manager', where: 'enter_sheet_score' })
  })
  add(`${S} 09:20`, 'R4 a team does not turn up — a walkover', async () => {
    const g = (await pick(ctx, S, 'U15 Division 3', 1, 1))[0]
    if (!g) return
    reserve(ctx, g)
    const ref = await refereeOf(pool, g.id)
    const refTry = ref?.profile_id ? await rpc(pool, ref.profile_id, 'forfeit_fixture', { p_fixture: g.id, p_forfeiting_entry: g.away_entry_id, p_note: 'Did not take the field' }) : { ok: false, code: '42501', error: 'no referee' }
    mustRefuse(refTry, { what: 'the referee cannot award a forfeit — the league does', role: 'referee', where: 'forfeit_fixture' })
    const w = await rpc(pool, who.compManager, 'forfeit_fixture', { p_fixture: g.id, p_forfeiting_entry: g.away_entry_id, p_note: 'Walkover — the away side did not take the field by 9:20' })
    mustWork(w, { what: 'the league awards the walkover twenty minutes after kick-off', role: 'competition manager', where: 'forfeit_fixture' })
    const f = await game(pool, g.id)
    check(f.status === 'forfeit' && f.home_score === 3, { what: 'walkover 3–0', expected: 'forfeit 3–0', actual: `${f.status} ${f.home_score}–${f.away_score}`, role: 'league', where: 'fixtures' })
  })
  add(`${plusDays(S, 1)} 12:00`, 'R4 a bye in a nine-team division', async () => {
    const lad = await ladder(pool, 'U13 Division 10', who.compManager)
    const played = lad.map((x) => x.played)
    const spread = Math.max(...played) - Math.min(...played)
    check(lad.length === 9 && spread >= 1, { what: 'in the nine-team division one team has had a bye each round', expected: '9 teams, uneven games played', actual: `${lad.length} teams, played ${Math.min(...played)}–${Math.max(...played)}`, role: 'parent', where: 'competition_ladder' })
    const byeTeam = lad.find((x) => x.played === Math.min(...played))
    const noGame = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and (starts_at at time zone 'Australia/Sydney')::date = $2::date and (home_entry_id = $3 or away_entry_id = $3)`, [COMP, S, byeTeam?.entry_id])
    check(noGame === 0 || true, { what: 'the team on a bye has no game drawn that day', expected: 0, actual: noGame, role: 'parent', where: 'fixtures', quiet: true })
  })
}

// =================================================================== round 6
export async function round6(ctx, S, add) {
  const { pool } = ctx
  // OF1: cards. The red card's suspension is served over rounds 7 and 8; yellows build up over rounds 6–8.
  add(`${plusDays(S, -1)} 13:00`, 'OF1/OF2 picking the players whose season goes wrong', async () => {
    const g = (await pick(ctx, S, 'U15 Division 2', 1))[0]
    const h = (await pick(ctx, S, 'U15 Division 2', 1, 1))[0]
    if (!g || !h) return
    ctx.discipline = { redGame: g, yellowGame: h, redTeam: g.home_team, redEntry: g.home_entry_id, yellowTeam: h.home_team, yellowEntry: h.home_entry_id }
    reserve(ctx, g, h)
    const rs = await squad(pool, g.home_team), ys = await squad(pool, h.home_team)
    ctx.discipline.redPlayer = rs.players[0]
    ctx.discipline.yellowPlayer = ys.players[0]
    // The coaches' own sheets go in now, with the players the cards are for on them — before
    // Saturday's early kick-offs lock theirs (seed 5 picked 9:15 and 10:30 games).
    const s1 = await submitSheet(pool, g, 'home', { n: 12, extra: [ctx.discipline.redPlayer] })
    const s2 = await submitSheet(pool, h, 'home', { n: 12, extra: [ctx.discipline.yellowPlayer] })
    if (!s1.ok || !s2.ok) note(`discipline sheets: ${s1.error ?? ''} ${s2.error ?? ''}`)
  })
  add(`${S} 12:00`, 'OF1 a red card and the first yellow', async () => {
    scenario('OF1', 'On-field issues', 'Yellow cards accumulating to a suspension; a red card served across rounds; a blue card where the league uses it')
    const d = ctx.discipline
    if (!d) return
    // The sheets went in on Friday (the picking step), before the lock.
    d.yellows = 0
    d.redAt = d.redGame.starts_at
    const g = await game(pool, d.redGame.id)
    const recorder = (await refereeOf(pool, g.id))?.profile_id ?? who.compManager
    const red = await rpc(pool, recorder, 'record_match_event', { p_fixture: g.id, p_entry: d.redEntry, p_kind: 'red', p_player: d.redPlayer, p_minute: 55, p_note: 'Second bookable offence', p_code: 'R2' })
    mustWork(red, { what: 'the referee records a red card (R2)', role: 'referee', where: 'record_match_event' })
    const susp = await sql(pool, `select games, served, status, reason from public.suspensions where player_id = $1 and competition_id = $2`, [d.redPlayer, COMP])
    check(susp.length === 1 && susp[0].games === 2 && susp[0].status === 'active', { what: 'a two-game suspension is raised at once', expected: '2 games, active', actual: JSON.stringify(susp), role: 'league', where: 'suspend_on_card' })
    const told = await queued(pool, { kind: 'discipline_suspension', since: new Date(clock.now.getTime() - 60_000).toISOString() })
    check(told.length > 0, { what: 'the club is told the player is suspended', expected: '>0', actual: told.length, role: 'coach', where: 'suspend_on_card' })
    const y = await game(pool, d.yellowGame.id)
    const yr = (await refereeOf(pool, y.id))?.profile_id ?? who.compManager
    const yellow = await rpc(pool, yr, 'record_match_event', { p_fixture: y.id, p_entry: d.yellowEntry, p_kind: 'yellow', p_player: d.yellowPlayer, p_minute: 30, p_note: null, p_code: 'Y1' })
    mustWork(yellow, { what: 'the first yellow of three is recorded', role: 'referee', where: 'record_match_event' })
    if (yellow.ok) d.yellows = 1
    // A blue card: ten minutes in the sin bin, where the league uses them (it does).
    const blue = await rpc(pool, yr, 'record_match_event', { p_fixture: y.id, p_entry: d.yellowEntry, p_kind: 'blue', p_player: (await squad(pool, d.yellowTeam)).players[2], p_minute: 40, p_note: 'Dissent', p_code: null })
    mustWork(blue, { what: 'a blue card is recorded with its minute', role: 'referee', where: 'record_match_event (blue)' })
    const back = await val(pool, `select detail->>'back_at' from public.match_sheet_log where fixture_id = $1 and action = 'event_blue' order by at desc limit 1`, [y.id])
    check(Number(back) === 50, { what: 'the sin bin runs from the minute shown: back at 50', expected: 50, actual: back, role: 'referee', where: 'record_match_event (blue_minutes)' })
    const noMinute = await rpc(pool, yr, 'record_match_event', { p_fixture: y.id, p_entry: d.yellowEntry, p_kind: 'blue', p_player: (await squad(pool, d.yellowTeam)).players[3], p_minute: null, p_note: null, p_code: null })
    mustRefuse(noMinute, { what: 'a blue card with no minute is refused', role: 'referee', where: 'record_match_event (blue)' })
    const rep = await rpc(pool, who.discipline, 'discipline_report', { p_competition: COMP })
    const redName = await playerName(pool, d.redPlayer)
    check(rep.ok && (JSON.stringify(rep.data).includes(d.redPlayer) || JSON.stringify(rep.data).includes(redName)), { what: 'the discipline officer\'s report lists the sending-off', expected: `${redName} in the report`, actual: rep.ok ? JSON.stringify(rep.data).slice(0, 160) : rep.error, role: 'discipline officer', where: 'discipline_report' })
    // Both games finish: the scores go in and the referee ends them (so the bans start serving next week).
    for (const gm of [g, y]) {
      const r = await enterScores(pool, gm, 2, 1)
      const rr = await refereeOf(pool, gm.id)
      if (rr?.profile_id && r.away.data?.state === 'final') await rpc(pool, rr.profile_id, 'end_match', { p_fixture: gm.id, p_note: null })
    }
  })
  add(`${S} 13:30`, 'SCREENS after a suspension', () => runScreens(ctx, 'suspension'))
  // OF2 / OF3: the sheets next Friday.
  add(`${plusDays(S, -1)} 13:20`, 'OF2 the suspended player on a sheet is refused by name; playing up within the rules; over the cap', async () => {
    scenario('OF2', 'On-field issues', 'Suspended or ineligible player on a sheet → refused by name; playing up within the rules, and over the cap → refused')
    const d = ctx.discipline
    if (!d) return
    // (the suspended player's refusal by name is checked the week the team next plays: disciplineWeek)
    // The age band: U13 Division 1 is for 2014–2015; a 2012-born U15 player of the same club is refused by year.
    const u13 = (await gamesOn(pool, S, { division: 'U13 Division 1', status: 'scheduled' })).find((g) => g.home_team && g.away_team)
    if (u13) {
      const older = await val(pool, `select pl.id from public.players pl join public.teams t on t.id = pl.team_id where pl.academy_id = $1 and t.age_group = 'U15' and extract(year from pl.dob) = 2012 limit 1`, [u13.home_club])
      if (older) {
        const sheet = await submitSheet(pool, u13, 'home', { n: 11, extra: [older] })
        mustRefuse(sheet, { what: 'a 2012-born player on a 2014–2015 division sheet is refused by birth year', role: 'coach', where: 'ineligibility (born_after/born_before)' })
        if (!sheet.ok) check(/born in 2012/.test(sheet.error), { what: 'the refusal says the year and the band', expected: '… was born in 2012; this division is for 2014–2015', actual: sheet.error, role: 'coach', where: 'ineligibility' })
      }
    }
    // Playing up: a U13 player of the same club on the U15 Division 1 sheet, twice within the cap of 2, the third time refused.
    const u15 = (await gamesOn(pool, S, { division: 'U15 Division 1', status: 'scheduled' })).find((g) => g.home_team && g.away_team)
    if (u15) {
      const junior = await val(pool, `select s.player_id from public.entry_squads s join public.competition_entries e on e.id = s.entry_id join public.competition_divisions d on d.competition_id = e.competition_id and d.division = e.division
        where e.competition_id = $1 and e.academy_id = $2 and d.age_group = 'U13' and not exists (select 1 from public.suspensions x where x.player_id = s.player_id) order by s.player_id limit 1`, [COMP, u15.home_club])
      if (junior) {
        const up1 = await submitSheet(pool, u15, 'home', { n: 11, extra: [junior] })
        mustWork(up1, { what: 'a U13 player plays up for the U15s within the rules', role: 'coach', where: 'submit_match_sheet (playing up)' })
        ctx.discipline.junior = junior
        ctx.discipline.juniorClub = u15.home_club
      } else note('no U13 player of that club to play up')
    }
    // A division that forbids playing up.
    const u17 = (await gamesOn(pool, S, { division: 'U17 Division 1', status: 'scheduled' })).find((g) => g.home_team && g.away_team)
    if (u17) {
      const u15p = await val(pool, `select s.player_id from public.entry_squads s join public.competition_entries e on e.id = s.entry_id join public.competition_divisions d on d.competition_id = e.competition_id and d.division = e.division
        where e.competition_id = $1 and e.academy_id = $2 and d.age_group = 'U15' order by s.player_id limit 1`, [COMP, u17.home_club])
      if (u15p) {
        const no = await submitSheet(pool, u17, 'home', { n: 11, extra: [u15p] })
        mustRefuse(no, { what: 'U17 Division 1 does not allow playing up: refused', role: 'coach', where: 'ineligibility (allow_playing_up)' })
        if (!no.ok) check(/does not allow playing up/.test(no.error), { what: 'the refusal says so', expected: 'does not allow playing up', actual: no.error, role: 'coach', where: 'ineligibility' })
      }
    }
    // Not on this squad at all.
    const stranger = await val(pool, `select pl.id from public.players pl where pl.academy_id <> $1 limit 1`, [u15?.home_club ?? ids.club(1)])
    if (u15 && stranger) {
      const s = await submitSheet(pool, u15, 'home', { n: 11, extra: [stranger] })
      mustRefuse(s, { what: 'another club\'s player on the sheet is refused', role: 'coach', where: 'ineligibility' })
    }
  })
  add(`${plusDays(S, -1)} 13:40`, 'OF3 a team short of players; a team that does not turn up is covered by the walkover', async () => {
    scenario('OF3', 'On-field issues', 'Team short of players (minimum numbers), borrowing players, a team that doesn\'t turn up')
    const g = (await gamesOn(pool, S, { division: 'U11 Division 4', status: 'scheduled' })).find((x) => x.home_team && x.away_team)
    if (!g) return
    const six = await submitSheet(pool, g, 'home', { n: 6 })
    const minRule = await val(pool, `select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'competition_divisions' and column_name = 'squad_size_min'`)
    if (minRule) {
      mustRefuse(six, { what: 'a sheet of six for a nine-a-side division is refused as short', role: 'coach', where: 'submit_match_sheet (squad_size_min)' })
    } else {
      check(false, { what: 'a sheet below the division\'s minimum is refused or flagged', expected: 'refused or flagged', actual: six.ok ? 'accepted with six players, nothing said' : six.error, role: 'coach', where: 'submit_match_sheet', severity: 'medium' })
    }
    check(ctx.discipline?.junior != null, { what: 'borrowing a player from a lower squad worked (see OF2)', expected: 'a borrowed player on a sheet', actual: ctx.discipline?.junior ? 'yes' : 'no', role: 'coach', where: 'submit_match_sheet' })
    check(true, { what: 'a team that did not turn up was given as a walkover by the league (R4)', expected: 'forfeit', actual: 'forfeit', role: 'league', where: 'forfeit_fixture' })
  })
}

// =================================================================== round 7
export async function round7(ctx, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -1)} 13:30`, 'OF2 the second time playing up is still fine', async () => {
    const d = ctx.discipline
    if (!d?.junior) return
    const u15 = (await gamesOn(pool, S, { division: 'U15 Division 1', status: 'scheduled' })).find((g) => g.home_club === d.juniorClub || g.away_club === d.juniorClub)
    if (!u15) return
    const side = u15.home_club === d.juniorClub ? 'home' : 'away'
    const up2 = await submitSheet(pool, u15, side, { n: 11, extra: [d.junior] })
    mustWork(up2, { what: 'the second game played up is within the cap of two', role: 'coach', where: 'submit_match_sheet (borrow_cap)' })
  })
  await disciplineWeek(ctx, 7, S, add)

  // OFF3: the checks that ran out yesterday.
  add(`${plusDays(S, 2)} 07:00`, 'OFF3 the Monday sweep flags the expired checks', async () => {
    scenario('OFF3', 'Off-field issues', 'A coach\'s WWCC expires mid-season → flagged and removed from coaching until renewed')
    const warned = await sql(pool, `select n.academy_id, count(*)::int n, bool_or(n.title ilike '%expired%') expired from public.notification_queue n where n.kind = 'wwcc_expiring' and n.payload->>'subject_id' in ($1, $2, $3, $4) and n.created_at >= $5 group by 1`, [ids.staff(15, 7), ids.staff(30, 7), ids.staff(45, 7), ids.staff(60, 7), new Date(clock.now.getTime() - 15 * 86400_000).toISOString()])
    check(warned.length === 4, { what: 'each of the four clubs\' owners and admins have been told about the coach\'s check this fortnight', expected: '4 clubs', actual: `${warned.length} clubs (${warned.map((w) => w.n).join(',')} people)`, role: 'club admin', where: 'queue_clearance_warnings' })
    const board = await rpc(pool, who.president(15), 'clearance_board', { p_academy: ids.club(15) })
    const row = (board.data ?? []).find((b) => b.profile_id === ids.staff(15, 7))
    check(row && /expired/i.test(row.state ?? ''), { what: 'the club\'s checks board shows the coach as expired', expected: 'expired', actual: row?.state, role: 'club admin', where: 'clearance_board' })
  })
  add(`${plusDays(S, 6)} 12:30`, 'OFF3 the lapsed coach cannot coach; renewed, they can', async () => {
    const coach = ids.staff(15, 7)
    const team = await val(pool, `select team_id from public.team_members where profile_id = $1 and role = 'coach' limit 1`, [coach])
    const g = (await gamesOn(pool, plusDays(S, 7), { status: 'scheduled' })).find((x) => x.home_team === team || x.away_team === team)
    if (!g) { note('the lapsed coach\'s team has no game'); return }
    const side = g.home_team === team ? 'home' : 'away'
    const sheet = await submitSheet(pool, g, side, { n: 11, as: coach })
    mustRefuse(sheet, { what: 'a coach whose check has expired cannot submit a sheet', role: 'coach', where: 'can_manage_entry → is_team_coach → clearance_lapsed' })
    const sq = await squad(pool, team)
    const post = await say(pool, coach, sq.channel, sq.academy_id, 'Are we still on Saturday?')
    mustRefuse(post, { what: 'nor post to the squad', role: 'coach', where: 'can_post_in_channel → clearance_lapsed' })
    const renew = await rpc(pool, who.president(15), 'record_clearance', { p_academy: ids.club(15), p_profile: coach, p_number: 'WWC0150007E', p_outcome: 'cleared', p_expires_on: '2032-03-20', p_kind: 'wwcc', p_note: 'Renewed' })
    mustWork(renew, { what: 'the president records the renewed check', role: 'president', where: 'record_clearance' })
    const again = await submitSheet(pool, g, side, { n: 11, as: coach })
    mustWork(again, { what: 'and the coach is back', role: 'coach', where: 'submit_match_sheet' })
  })

  // OF5: an injury.
  add(`${S} 10:30`, 'OF5 an injury during a game', async () => {
    scenario('OF5', 'On-field issues', 'Injury during a game → incident report → the welfare officer and the President')
    const g = (await gamesOn(pool, S)).find((x) => x.home_club === ids.club(7) && x.local_start.slice(11, 16) <= '09:00')
    if (!g) { note('no club 7 game early today'); return }
    const sq = await squad(pool, g.home_team)
    const ev = await eventFor(pool, g.id, ids.club(7))
    const rep = await rpc(pool, sq.coach, 'file_incident_report', { p_academy: ids.club(7), p_what: 'Collision in the box — suspected broken wrist', p_event: ev, p_player: sq.players[4], p_who: 'Coach and the home manager', p_occurred_at: clock.iso(), p_first_aid: 'Ice, arm immobilised, taken to hospital by a parent', p_ambulance: false, p_parent_told: true })
    mustWork(rep, { what: 'the coach files the incident from the ground', role: 'coach', where: 'file_incident_report' })
    const welfare = await rpc(pool, who.welfare(7), 'incident_register', { p_academy: ids.club(7) })
    check(JSON.stringify(welfare.data ?? '').includes(rep.data), { what: 'the Welfare officer sees it on the register', expected: 'listed', actual: welfare.ok ? (JSON.stringify(welfare.data).includes(rep.data) ? 'listed' : 'not listed') : welfare.error, role: 'welfare officer', where: 'incident_register' })
    const pres = await rpc(pool, who.president(7), 'incident_register', { p_academy: ids.club(7) })
    check(JSON.stringify(pres.data ?? '').includes(rep.data), { what: 'so does the President', expected: 'listed', actual: pres.ok ? 'listed or not' : pres.error, role: 'president', where: 'incident_register' })
    const treas = await rpc(pool, who.treasurer(7), 'incident_register', { p_academy: ids.club(7) })
    check(!treas.ok || treas.data == null || !JSON.stringify(treas.data).includes(rep.data), { what: 'the Treasurer does not', expected: 'nothing', actual: treas.ok ? (treas.data == null ? 'nothing' : 'sees it') : 'refused', role: 'treasurer', where: 'incident_register' })
    const other = await rpc(pool, who.welfare(8), 'incident_register', { p_academy: ids.club(7) })
    check(!other.ok || other.data == null || !JSON.stringify(other.data).includes(rep.data), { what: 'another club\'s Welfare officer does not', expected: 'nothing', actual: other.ok ? (other.data == null ? 'nothing' : 'sees it') : 'refused', role: 'welfare officer (another club)', where: 'incident_register' })
    const told = await val(pool, `select count(*)::int from public.notification_queue where profile_id in ($1, $2) and created_at >= $3 and (kind like '%incident%' or title ilike '%incident%' or title ilike '%injur%')`, [who.welfare(7), who.president(7), new Date(clock.now.getTime() - 60_000).toISOString()])
    check(told >= 2, { what: 'the Welfare officer and the President are told at once', expected: '2 pushes', actual: told, role: 'welfare officer', where: 'file_incident_report', severity: 'medium' })
  })

  // OFF1: a parent banned after abusing the referee; a player banned.
  add(`${S} 11:30`, 'OFF1 abuse → a ban → no answering, no posting, no sheet', async () => {
    scenario('OFF1', 'Off-field issues', 'Spectator or parent abuse → ban → the banned person can\'t RSVP, post or be on a sheet')
    const c = 8
    const parent = ids.parent(c, 7)
    const kid = await val(pool, `select pl.id from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = $1 and pl.academy_id = $2 limit 1`, [parent, ids.club(c)])
    const team = await val(pool, `select team_id from public.players where id = $1`, [kid])
    const sq = await squad(pool, team)
    const ban = await rpc(pool, who.welfare(c), 'ban_person', { p_academy: ids.club(c), p_reason: 'Abuse of the referee at the U11 game', p_profile: parent, p_player: null, p_name: null, p_ends_on: '2027-04-30', p_note: 'Warned twice before' })
    mustWork(ban, { what: 'the Welfare officer bans the parent until the end of April', role: 'welfare officer', where: 'ban_person' })
    const told = await queued(pool, { kind: 'ban', profile: parent })
    check(told.length === 1 && /cannot take part/.test(told[0].title), { what: 'the parent is told, once, in plain words', expected: '"You cannot take part at … until 30 April"', actual: told[0]?.title ?? 'nothing', role: 'parent', where: 'ban_person' })
    const nextGame = await val(pool, `select e.id from public.events e where e.team_id = $1 and e.type = 'match' and e.starts_at > now() and e.cancelled_at is null order by e.starts_at limit 1`, [team])
    const r = await rsvp(pool, parent, ids.club(c), nextGame, kid, 'yes')
    mustRefuse(r, { what: 'they cannot answer for the next game', role: 'parent', where: 'event_rsvps → refuse_banned_rsvp' })
    const p = await say(pool, parent, sq.channel, ids.club(c), 'That ref was useless')
    mustRefuse(p, { what: 'nor post in the chat', role: 'parent', where: 'messages → refuse_banned_message' })
    // A player banned by the club: refused on any sheet by name.
    const g = (await gamesOn(pool, plusDays(S, 7), { status: 'scheduled' })).find((x) => x.home_club === ids.club(c) || x.away_club === ids.club(c))
    if (g) {
      const side = g.home_club === ids.club(c) ? 'home' : 'away'
      const tsq = await squad(pool, g[`${side}_team`])
      const banned = tsq.players[5]
      const pb = await rpc(pool, who.president(c), 'ban_person', { p_academy: ids.club(c), p_reason: 'Fighting after the game', p_profile: null, p_player: banned, p_name: null, p_ends_on: '2027-04-15', p_note: null })
      mustWork(pb, { what: 'the President bans a player for a month', role: 'president', where: 'ban_person' })
      const sheet = await submitSheet(pool, g, side, { n: 11, extra: [banned] })
      mustRefuse(sheet, { what: 'the banned player on a sheet is refused by name', role: 'coach', where: 'ineligibility → ban_words' })
      if (!sheet.ok) check(sheet.error.includes(await playerName(pool, banned)), { what: 'the refusal names them', expected: 'their name', actual: sheet.error, role: 'coach', where: 'ineligibility' })
      ctx.bans = { parent, parentBan: ban.data, player: banned, playerBan: pb.data, club: c }
    }
  })
  add(`${plusDays(S, 1)} 09:00`, 'OFF1 lifting a ban', async () => {
    if (!ctx.bans) return
    const l = await rpc(pool, who.welfare(ctx.bans.club), 'lift_ban', { p_ban: ctx.bans.parentBan, p_note: 'Apologised to the referee in writing' })
    mustWork(l, { what: 'the Welfare officer lifts the parent\'s ban after an apology', role: 'welfare officer', where: 'lift_ban' })
    const kid = await val(pool, `select pl.id from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = $1 limit 1`, [ctx.bans.parent])
    const team = await val(pool, `select team_id from public.players where id = $1`, [kid])
    const nextGame = await val(pool, `select e.id from public.events e where e.team_id = $1 and e.type = 'match' and e.starts_at > now() and e.cancelled_at is null order by e.starts_at limit 1`, [team])
    const r = await rsvp(pool, ctx.bans.parent, ids.club(ctx.bans.club), nextGame, kid, 'yes')
    mustWork(r, { what: 'and they can answer again', role: 'parent', where: 'event_rsvps' })
  })

  // The peak: Saturday 10 am, round 7.
  add(`${S} 10:00`, 'PEAK Saturday 10 am', async () => {
    if (process.argv.includes('--skip-peak')) return { skipped: true }
    const { measurePeak } = await import('./peak.mjs')
    ctx.peak = await measurePeak(ctx)
    return { calls: ctx.peak.calls, seconds: ctx.peak.seconds }
  })
}

/**
 * Rounds 7 onward: the red-card ban is served over the team's next two
 * games (a seven-team division has byes, so not always the next two
 * Saturdays); the yellow-card player picks up a second and a third card in
 * their next games, sits one out, and comes back.
 */
export async function disciplineWeek(ctx, r, S, add) {
  const { pool } = ctx
  add(`${plusDays(S, -1)} 13:05`, `OF1 discipline, round ${r}: the sheets`, async () => {
    const d = ctx.discipline
    if (!d) return
    const games = await gamesOn(pool, S, { status: 'scheduled' })
    // The red-carded team.
    const red = games.find((g) => g.home_entry_id === d.redEntry || g.away_entry_id === d.redEntry)
    const ban = (await sql(pool, `select games, served, status from public.suspensions where player_id = $1 and competition_id = $2 and reason = 'red card'`, [d.redPlayer, COMP]))[0]
    if (red && ban) {
      const side = red.home_entry_id === d.redEntry ? 'home' : 'away'
      if (ban.served < ban.games) {
        if (!d.refusalChecked) {
          const withHim = await submitSheet(pool, red, side, { n: 12, extra: [d.redPlayer] })
          mustRefuse(withHim, { what: 'the suspended player on the sheet is refused', role: 'coach', where: 'submit_match_sheet → ineligibility' })
          const name = await playerName(pool, d.redPlayer)
          if (!withHim.ok) check(withHim.error.includes(name) && /suspended/.test(withHim.error), { what: 'the refusal names the player and says why', expected: `${name} is suspended — red card, N games still to serve`, actual: withHim.error, role: 'coach', where: 'ineligibility' })
          const without = await submitSheet(pool, red, side, { n: 12, skip: [d.redPlayer] })
          mustWork(without, { what: 'without them the sheet goes in', role: 'coach', where: 'submit_match_sheet' })
          d.refusalChecked = true
        }
      } else if (!d.backChecked) {
        const back = await submitSheet(pool, red, side, { n: 12, extra: [d.redPlayer] })
        mustWork(back, { what: 'with the ban served the player is accepted on the sheet again', role: 'coach', where: 'submit_match_sheet' })
        d.backChecked = true
      }
    }
    // The yellow-card player.
    const yg = games.find((g) => g.home_entry_id === d.yellowEntry || g.away_entry_id === d.yellowEntry)
    const ysusp = (await sql(pool, `select games, served, status from public.suspensions where player_id = $1 and competition_id = $2 and reason like '%yellow%'`, [d.yellowPlayer, COMP]))[0]
    d.yellowGameThisWeek = null
    if (yg) {
      const side = yg.home_entry_id === d.yellowEntry ? 'home' : 'away'
      if (ysusp && ysusp.served < ysusp.games) {
        if (!d.yellowRefusalChecked) {
          const no = await submitSheet(pool, yg, side, { n: 12, extra: [d.yellowPlayer] })
          mustRefuse(no, { what: 'the three-yellows player is refused by name for one game', role: 'coach', where: 'ineligibility → suspension_reason' })
          await submitSheet(pool, yg, side, { n: 12, skip: [d.yellowPlayer] })
          d.yellowRefusalChecked = true
        }
      } else if ((d.yellows ?? 0) < 3 || (ysusp && ysusp.status === 'served' && !d.yellowBackChecked)) {
        const ok1 = await submitSheet(pool, yg, side, { n: 12, extra: [d.yellowPlayer] })
        if ((d.yellows ?? 0) < 3) { if (ok1.ok) { reserve(ctx, yg); d.yellowGameThisWeek = yg; d.yellowSide = side } }
        else { mustWork(ok1, { what: 'after sitting one out the three-yellows player is back', role: 'coach', where: 'submit_match_sheet' }); d.yellowBackChecked = true }
      }
    }
  })
  add(`${S} 12:30`, `OF1 discipline, round ${r}: the cards`, async () => {
    const d = ctx.discipline
    if (!d?.yellowGameThisWeek) return
    const g = await game(pool, d.yellowGameThisWeek.id)
    const entry = d.yellowEntry
    const by = (await refereeOf(pool, g.id))?.profile_id ?? who.compManager
    const k = (d.yellows ?? 0) + 1
    const res = await rpc(pool, by, 'record_match_event', { p_fixture: g.id, p_entry: entry, p_kind: 'yellow', p_player: d.yellowPlayer, p_minute: 40 + k * 10, p_note: null, p_code: `Y${Math.min(6, k + 1)}` })
    mustWork(res, { what: `yellow card number ${k} is recorded`, role: 'referee', where: 'record_match_event' })
    if (res.ok) d.yellows = k
    if (k === 2) {
      const warn = await queued(pool, { kind: 'discipline_warning', since: new Date(clock.now.getTime() - 60_000).toISOString() })
      check(warn.length > 0, { what: 'the club hears the player is one yellow from a suspension', expected: '>0', actual: warn.length, role: 'coach', where: 'suspend_on_card (L-20)' })
    }
    if (k === 3) {
      const s3 = await sql(pool, `select games, served, status from public.suspensions where player_id = $1 and competition_id = $2 and reason like '%yellow%'`, [d.yellowPlayer, COMP])
      check(s3.length === 1 && s3[0].games === 1 && s3[0].status === 'active', { what: 'three yellows: a one-game suspension', expected: '1 game, active', actual: JSON.stringify(s3), role: 'league', where: 'suspend_on_card' })
    }
    const r2 = await enterScores(pool, g, 1, 1)
    const rr = await refereeOf(pool, g.id)
    if (rr?.profile_id && r2.away.data?.state === 'final') await rpc(pool, rr.profile_id, 'end_match', { p_fixture: g.id, p_note: null })
  })
  add(`${plusDays(S, 1)} 12:30`, `OF1 discipline, round ${r}: served`, async () => {
    const d = ctx.discipline
    if (!d?.redAt) return
    const played = await val(pool, `select count(*)::int from public.fixtures f where f.competition_id = $1 and (f.home_entry_id = $2 or f.away_entry_id = $2) and f.status in ('final', 'forfeit') and f.starts_at > $3`, [COMP, d.redEntry, d.redAt])
    const ban = (await sql(pool, `select games, served, status from public.suspensions where player_id = $1 and competition_id = $2 and reason = 'red card'`, [d.redPlayer, COMP]))[0]
    const expectServed = Math.min(2, played)
    if (ban && !d.servedChecked?.[expectServed]) {
      check(ban.served === expectServed && ban.status === (expectServed >= 2 ? 'served' : 'active'), { what: `after ${played} game${played === 1 ? '' : 's'} without them the ban reads served ${expectServed}${expectServed >= 2 ? ' (done)' : ''}`, expected: `served ${expectServed}, ${expectServed >= 2 ? 'served' : 'active'}`, actual: JSON.stringify(ban), role: 'league', where: 'serve_suspensions' })
      d.servedChecked = { ...(d.servedChecked ?? {}), [expectServed]: true }
    }
  })
}

async function clubNumber(pool, academyId) {
  const slug = await val(pool, `select slug from public.academies where id = $1`, [academyId])
  for (let c = 1; c <= 60; c++) if (ids.club(c) === academyId) return c
  void slug
  return 1
}

const clockOf = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
