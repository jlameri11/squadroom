// A normal week in SPL Season 4: what every league, club, coach, referee and
// family does round after round. The scenarios (scenarios.mjs) are the
// exceptions laid on top of this. Everything here is done AS the person who
// would do it, through the same functions the screens call.
import { check, clock, ids, note, rpc, run, scenario, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, advanceTo, enterScores, gamesOn, kickoffPlus, noticesChannel, refereeOf, rsvp, say, react, squad, submitSheet } from './world.mjs'

/** A seeded random, so a run is repeatable. */
export function rng(seed) {
  let s = seed >>> 0
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  next.int = (n) => Math.floor(next() * n)
  next.pick = (xs) => xs[Math.floor(next() * xs.length)]
  next.chance = (p) => next() < p
  return next
}

/** A Sydney date string plus days. */
export function plusDays(date, days) {
  const d = new Date(`${date}T12:00:00+10:00`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- the league
/** Sunday evening: the league speaks to everyone, and to club staff. */
export async function leagueNotices(ctx, r) {
  const chan = await noticesChannel(ctx.pool)
  const a = await say(ctx.pool, who.compManager, chan, LEAGUE, `Round ${r} is on this Saturday. Check your kick-off and ground in Fixtures; wet-weather calls go out here by 7 am.`, { audience: 'everyone', is_announcement: true })
  const b = await say(ctx.pool, who.compManager, chan, LEAGUE, `Club staff: team sheets in by Friday 6 pm, please. Late sheets are refused by the system after the lock.`, { audience: 'club_staff', is_announcement: true })
  ctx.stats.notices += (a.ok ? 1 : 0) + (b.ok ? 1 : 0)
  ctx.lastNotices = { everyone: a.data?.[0]?.id, staff: b.data?.[0]?.id, at: clock.iso() }
  if (!a.ok || !b.ok) note(`a notice was refused: ${a.error ?? ''} ${b.error ?? ''}`)
  return { everyone: a.data?.[0]?.id, staff: b.data?.[0]?.id }
}

/** The referee coordinator proposes and appoints for a day; the pool answers on Monday. */
export async function appointReferees(ctx, date) {
  const prop = await rpc(ctx.pool, who.refCoordinator, 'propose_referee_allocation', { p_competition: COMP, p_date: date, p_division: null })
  if (!prop.ok) { note(`propose_referee_allocation refused: ${prop.error}`); return { appointed: 0, free: 0 } }
  const rows = prop.data ?? []
  const app = await rpc(ctx.pool, who.refCoordinator, 'apply_referee_allocation', { p_competition: COMP, p_rows: JSON.stringify(rows) })
  const nobody = rows.filter((x) => !x.referee_id).length
  ctx.stats.appointments += app.data?.appointed ?? 0
  if (!app.ok) note(`apply_referee_allocation refused: ${app.error}`)
  return { proposed: rows.length, appointed: app.data?.appointed ?? 0, failed: app.data?.failed?.length ?? 0, nobody }
}

export async function refereesRespond(ctx, date, rand) {
  const offers = await sql(ctx.pool, `
    select ap.id, r.profile_id, h.display_name || ' v ' || a.display_name as game
      from public.referee_appointments ap
      join public.referees r on r.id = ap.referee_id
      join public.fixtures f on f.id = ap.fixture_id
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where ap.competition_id = $1 and ap.status = 'offered' and r.profile_id is not null
       and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date`, [COMP, date])
  let accepted = 0, declined = 0
  for (const o of offers) {
    const roll = rand()
    if (roll < 0.88) { const res = await rpc(ctx.pool, o.profile_id, 'respond_appointment', { p_appointment: o.id, p_accept: true, p_note: null }); if (res.ok) accepted++ }
    else if (roll < 0.94) { const res = await rpc(ctx.pool, o.profile_id, 'respond_appointment', { p_appointment: o.id, p_accept: false, p_note: 'Working that morning' }); if (res.ok) declined++ }
  }
  // The coordinator fills what was declined.
  const again = await appointReferees(ctx, date)
  return { offers: offers.length, accepted, declined, refilled: again.appointed }
}

// ------------------------------------------------------------------ the clubs
/** Monday night in the clubs: a club message here and there, the team chats, the week's RSVPs. */
export async function clubLife(ctx, r, rand, { clubs = 12, chats = 60 } = {}) {
  let sent = 0, lines = 0, replies = 0, reactions = 0, polls = 0, rsvps = 0
  for (let i = 0; i < clubs; i++) {
    const c = 1 + ((r * 7 + i) % 60)
    const res = await rpc(ctx.pool, who.president(c), 'send_club_message', { p_academy: ids.club(c), p_body: `Round ${r} this weekend — canteen volunteers wanted, see the roster. Thanks to everyone who helped last week.`, p_audience: JSON.stringify({ kind: 'club' }), p_pinned: false, p_until: null, p_urgent: false })
    if (res.ok) sent++
  }
  const teams = await sql(ctx.pool, `select id from public.teams where season = '2027' order by id offset $1 limit $2`, [(r * 37) % 240, chats])
  for (const t of teams) {
    const sq = await squad(ctx.pool, t.id)
    if (!sq.channel || !sq.coach) continue
    const line = await say(ctx.pool, sq.coach, sq.channel, sq.academy_id, `Training Tuesday 5:30 as usual. Round ${r} on Saturday — I'll post the sheet Friday.`)
    if (!line.ok) continue
    lines++
    const mid = line.data[0].id
    for (const p of sq.parents.slice(0, 3)) {
      const rep = await say(ctx.pool, p, sq.channel, sq.academy_id, rand.pick(['Thanks coach!', 'We can do oranges.', 'Running late Tuesday, there by 5:45.', 'Is it the home kit?']), { reply_to_id: mid })
      if (rep.ok) replies++
    }
    for (const p of sq.parents.slice(3, 5)) {
      const rx = await react(ctx.pool, p, mid, sq.academy_id, rand.pick(['👍', '⚽', '🙌']))
      if (rx.ok && rx.data.length) reactions++
    }
    if (polls < 10 && rand.chance(0.3)) {
      const poll = await run(ctx.pool, sq.coach, `insert into public.polls (academy_id, channel_id, type, question, options, created_by)
        values ($1, $2, 'simple', 'Carpool from the north side on Saturday?', $3::jsonb, $4) returning id`,
        [sq.academy_id, sq.channel, JSON.stringify([{ id: 'yes', label: 'Yes, I can drive' }, { id: 'need', label: 'We need a lift' }, { id: 'no', label: 'No' }]), sq.coach])
      if (poll.ok) {
        polls++
        await say(ctx.pool, sq.coach, sq.channel, sq.academy_id, null, { poll_id: poll.data[0].id })
        for (const p of sq.parents.slice(0, 6)) {
          const kid = await val(ctx.pool, `select pl.id from public.players pl join public.player_guardians g on g.player_id = pl.id where g.profile_id = $1 and pl.team_id = $2 limit 1`, [p, sq.id])
          await rpc(ctx.pool, p, 'cast_poll_vote', { p_poll: poll.data[0].id, p_options: [rand.pick(['yes', 'need', 'no'])], p_player: kid, p_note: null })
        }
      }
    }
  }
  ctx.stats.clubMessages += sent
  ctx.stats.chatLines += lines + replies
  ctx.stats.reactions += reactions
  ctx.stats.polls += polls
  return { sent, lines, replies, reactions, polls }
}

/** Families answer for Saturday's games (most of them, most of the time). */
export async function weekRsvps(ctx, date, rand, { share = 0.8 } = {}) {
  const rows = await sql(ctx.pool, `
    select e.id as event_id, e.academy_id, g.profile_id, g.player_id
      from public.events e
      join public.fixtures f on f.id = e.fixture_id and f.competition_id = $1
      join public.players pl on pl.team_id = e.team_id
      join public.player_guardians g on g.player_id = pl.id and g.is_primary
     where (e.starts_at at time zone 'Australia/Sydney')::date = $2::date and e.cancelled_at is null`, [COMP, date])
  let n = 0, refused = 0
  const why = {}
  // Through RLS, in batches of one person's children: a parent answers for each child.
  for (const row of rows) {
    if (!rand.chance(share)) continue
    const res = await rsvp(ctx.pool, row.profile_id, row.academy_id, row.event_id, row.player_id, rand.chance(0.9) ? 'yes' : 'no')
    if (res.ok) n++
    else { refused++; const k = String(res.error).slice(0, 70); why[k] = (why[k] ?? 0) + 1 }
  }
  ctx.stats.rsvps += n
  const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3)
  return { answered: n, refused, of: rows.length, ...(top.length ? { why: Object.fromEntries(top) } : {}) }
}

/** Tuesday: coaches schedule Friday's "game tomorrow" line. */
export async function scheduleFridayLines(ctx, date, rand, { teams = 40 } = {}) {
  const rows = await sql(ctx.pool, `select t.id from public.teams t where t.season = (select c.season from public.competitions c where c.id = $3) order by t.id offset $1 limit $2`, [(teams * 3) % 200, teams, COMP])
  let n = 0
  const friday = `${plusDays(date, -1)} 18:00`
  for (const t of rows) {
    const sq = await squad(ctx.pool, t.id)
    if (!sq.channel || !sq.coach) continue
    const res = await rpc(ctx.pool, sq.coach, 'schedule_message', { p_channel: sq.channel, p_body: 'Game tomorrow. Arrive 30 minutes before kick-off, home kit, bring a drink bottle.', p_at: new Date(`${friday.replace(' ', 'T')}:00+11:00`).toISOString(), p_announcement: n % 8 === 0 })
    if (res.ok) n++
  }
  ctx.stats.scheduled += n
  return n
}

/** Friday: every side's coach submits a sheet; a few forget. */
export async function submitSheets(ctx, date, rand, { forget = 0.04, from = null, to = null } = {}) {
  const days = []
  for (let d = from ?? date; d <= (to ?? date); d = plusDays(d, 1)) days.push(d)
  const games = (await Promise.all(days.map((d) => gamesOn(ctx.pool, d, { status: 'scheduled' })))).flat()
  let ok = 0, refused = 0, forgot = 0
  const refusals = {}
  for (const g of games) {
    for (const side of ['home', 'away']) {
      if (!g[`${side}_team`]) continue
      if (rand.chance(forget)) { forgot++; continue }
      const res = await submitSheet(ctx.pool, g, side, { n: 11 + rand.int(4) })
      if (res.ok) ok++
      else { refused++; refusals[res.error] = (refusals[res.error] ?? 0) + 1 }
    }
  }
  ctx.stats.sheets += ok
  if (refused) note(`sheets refused: ${JSON.stringify(refusals).slice(0, 300)}`)
  return { games: games.length, submitted: ok, refused, forgot, refusals }
}

// ------------------------------------------------------------------ Saturday
/** Referees check in for the games kicking off at this moment (a few never turn up). */
export async function checkIns(ctx, games, rand, { noShow = 0.03 } = {}) {
  let n = 0, missing = 0
  for (const g of games) {
    const ref = await refereeOf(ctx.pool, g.id)
    if (!ref || ref.status !== 'accepted' || !ref.profile_id) { missing++; continue }
    if (rand.chance(noShow)) { ctx.noShows.push({ fixture: g.id, referee: ref.referee_id, name: ref.full_name }); continue }
    const res = await rpc(ctx.pool, ref.profile_id, 'referee_check_in', { p_appointment: ref.appointment_id })
    if (res.ok) n++
  }
  return { checkedIn: n, noReferee: missing }
}

/** Full time for a slot's games: cards during the game, the referee ends it, both sides enter the score. */
export async function fullTime(ctx, games, rand, { mismatch = 0.08, late = 0.03 } = {}) {
  let finals = 0, disputes = 0, cards = 0, lateOnes = 0, ended = 0
  for (const g of games) {
    if (g.status !== 'scheduled' || !g.home_team || !g.away_team) continue
    if (ctx.reserved?.has(g.id)) continue
    let home = rand.int(6), away = rand.int(5)
    // A knockout game has a winner (the one drawn semi-final is the scenario's, reserved above).
    if (g.stage === 'final' && home === away) home++
    // Cards, recorded by the referee (or the home manager when there is none).
    const ref = await refereeOf(ctx.pool, g.id)
    const recorder = ref?.profile_id && ref.checked_in_at ? ref.profile_id : (await squad(ctx.pool, g.home_team)).manager
    if (rand.chance(0.2)) {
      const side = rand.chance(0.5) ? 'home' : 'away'
      const entry = g[`${side}_entry_id`]
      const onSheet = await val(ctx.pool, `select sp.player_id from public.match_sheet_players sp join public.match_sheets s on s.id = sp.sheet_id where s.fixture_id = $1 and s.entry_id = $2 order by random() limit 1`, [g.id, entry])
      if (onSheet) {
        const kind = rand.chance(0.85) ? 'yellow' : 'red'
        const res = await rpc(ctx.pool, recorder, 'record_match_event', { p_fixture: g.id, p_entry: entry, p_kind: kind, p_player: onSheet, p_minute: 20 + rand.int(50), p_note: null, p_code: kind === 'yellow' ? 'Y1' : 'R2' })
        if (res.ok) cards++
      }
    }
    // Goals for the top scorers, on the home side.
    for (let i = 0; i < Math.min(home, 2); i++) {
      const scorer = await val(ctx.pool, `select sp.player_id from public.match_sheet_players sp join public.match_sheets s on s.id = sp.sheet_id where s.fixture_id = $1 and s.entry_id = $2 order by sp.number limit 1 offset $3`, [g.id, g.home_entry_id, i])
      if (scorer) await rpc(ctx.pool, recorder, 'record_match_event', { p_fixture: g.id, p_entry: g.home_entry_id, p_kind: 'goal', p_player: scorer, p_minute: 10 + i * 25, p_note: null, p_code: null })
    }
    if (rand.chance(late)) { ctx.lateResults.push({ fixture: g.id, home, away }); lateOnes++; continue }
    const r = await enterScores(ctx.pool, g, home, away, { mismatch: rand.chance(mismatch) })
    if (r.away.data?.state === 'final') finals++
    else if (r.away.data?.state === 'disputed') disputes++
    else if (!r.home.ok || !r.away.ok) note(`score refused: ${r.home.error ?? ''} ${r.away.error ?? ''}`)
    // The referee ends the game once the sides have their scores in — ending it first locks them out.
    if (ref?.profile_id && ref.checked_in_at && r.away.data?.state === 'final') {
      const e = await rpc(ctx.pool, ref.profile_id, 'end_match', { p_fixture: g.id, p_note: null })
      if (e.ok) ended++
    }
  }
  ctx.stats.results += finals
  ctx.stats.disputes += disputes
  ctx.stats.cards += cards
  return { finals, disputes, cards, late: lateOnes, ended }
}

/** Sunday: the league rules on every dispute; late scores arrive; the ladders are read. */
export async function leagueSunday(ctx, rand) {
  const disputed = await sql(ctx.pool, `select f.id, s.entry_id, s.our_score, s.their_score, f.home_entry_id
                                          from public.fixtures f join public.match_sheets s on s.fixture_id = f.id
                                         where f.competition_id = $1 and f.score_disputed and f.status not in ('final', 'forfeit')
                                         order by f.id, s.entry_id`, [COMP])
  const byFixture = new Map()
  for (const d of disputed) (byFixture.get(d.id) ?? byFixture.set(d.id, []).get(d.id)).push(d)
  let ruled = 0
  for (const [fid, sheets] of byFixture) {
    const home = sheets.find((s) => s.entry_id === s.home_entry_id) ?? sheets[0]
    const res = await rpc(ctx.pool, who.compManager, 'rule_on_score', { p_fixture: fid, p_home: home.our_score, p_away: home.their_score, p_note: 'Referee report confirms the home sheet' })
    if (res.ok) ruled++
  }
  let late = 0
  for (const l of ctx.lateResults.splice(0)) {
    const g = await sql(ctx.pool, `select f.*, h.team_id as home_team, a.team_id as away_team from public.fixtures f join public.competition_entries h on h.id = f.home_entry_id join public.competition_entries a on a.id = f.away_entry_id where f.id = $1`, [l.fixture])
    if (!g[0] || g[0].status !== 'scheduled') continue
    const r = await enterScores(ctx.pool, g[0], l.home, l.away)
    if (r.away.data?.state === 'final') late++
  }
  ctx.stats.ruled += ruled
  ctx.stats.lateResults += late
  return { ruled, late }
}

/**
 * Sunday afternoon: whatever is still postponed from the week — a closed
 * ground, a pitch under water, an abandoned game — goes to the catch-up
 * round (22 May), same clock time and pitch where free, else the next free
 * quarter-hour that day. A season ends with every group game played, or
 * the finals cannot be seeded.
 */
export async function rescheduleLeftovers(ctx, catchup = '2027-05-22') {
  const left = await sql(ctx.pool, `
    select f.id, f.starts_at, f.duration_mins, f.pitch_id, f.venue_label, f.field_label,
           to_char(f.starts_at at time zone 'Australia/Sydney', 'HH24:MI') as hhmm
      from public.fixtures f
     where f.competition_id = $1 and f.status = 'postponed' and f.stage is distinct from 'final'
       and (f.starts_at at time zone 'Australia/Sydney')::date < $2::date
     order by f.starts_at`, [COMP, catchup])
  let moved = 0, stuck = 0
  for (const f of left) {
    const slot = await val(ctx.pool, `select min(t)::text from generate_series(($2::date::text || ' 08:00')::timestamp at time zone 'Australia/Sydney', ($2::date::text || ' 17:00')::timestamp at time zone 'Australia/Sydney', interval '15 minutes') t
      where t >= ($2::date::text || ' ' || $3)::timestamp at time zone 'Australia/Sydney'
        and ($1::uuid is null or (app_private.pitch_clash($1, t, t + make_interval(mins => $4), $5) is null and app_private.pitch_open($1, t, t + make_interval(mins => $4))))`,
      [f.pitch_id, catchup, f.hhmm, f.duration_mins ?? 60, f.id])
    if (!slot) { stuck++; continue }
    const r = await rpc(ctx.pool, who.grounds, 'reschedule_fixture', { p_fixture: f.id, p_starts_at: new Date(slot).toISOString(), p_venue_label: null, p_field: null })
    if (r.ok) moved++; else { stuck++; note(`catch-up: ${r.error}`) }
  }
  return { moved, stuck }
}
