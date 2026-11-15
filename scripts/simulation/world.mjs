// The simulated league's world, as the season driver and the scenarios see
// it: games on a day, the people around a squad, a team sheet, a score, the
// cron sweeps and the push drain, what the queue holds. Admin reads (outside
// RLS) for finding things; every ACTION goes through a person (lib.mjs).
import { asAdmin, asPerson, clock, ids, rpc, run, sql, sydney, sydneyDate, val } from './lib.mjs'

/** The competition the season plays in — Season 4 until the simulation starts Season 5 (setCompetition). A live binding: importers see the change. */
export let COMP = ids.comp
export const LEAGUE = ids.league
export function setCompetition(id) { COMP = id }

// ------------------------------------------------------------------ fixtures
/** The games on a Sydney date, with both sides and where they are. */
export async function gamesOn(pool, date, { division = null, venue = null, status = null } = {}) {
  return sql(pool, `
    select f.id, f.division, f.round, f.starts_at, f.duration_mins, f.status, f.stage, f.venue_label, f.field_label, f.pitch_id, f.venue_id,
           f.home_entry_id, f.away_entry_id, f.home_score, f.away_score, f.score_disputed, f.ended_at, f.notes, f.cancel_reason,
           h.display_name as home_name, h.team_id as home_team, h.academy_id as home_club,
           a.display_name as away_name, a.team_id as away_team, a.academy_id as away_club,
           p.size as pitch_size, v.name as venue_name,
           (f.starts_at at time zone 'Australia/Sydney')::text as local_start
      from public.fixtures f
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
      left join public.pitches p on p.id = f.pitch_id
      left join public.venues v on v.id = f.venue_id
     where f.competition_id = $1
       and (f.starts_at at time zone 'Australia/Sydney')::date = $2::date
       and ($3::text is null or f.division = $3)
       and ($4::uuid is null or f.venue_id = $4)
       and ($5::text is null or f.status::text = $5)
     order by f.starts_at, f.venue_label, f.field_label`, [COMP, date, division, venue, status])
}

export async function game(pool, id) {
  const rows = await sql(pool, `
    select f.*, h.display_name as home_name, h.team_id as home_team, h.academy_id as home_club,
           a.display_name as away_name, a.team_id as away_team, a.academy_id as away_club,
           (f.starts_at at time zone 'Australia/Sydney')::text as local_start
      from public.fixtures f
      left join public.competition_entries h on h.id = f.home_entry_id
      left join public.competition_entries a on a.id = f.away_entry_id
     where f.id = $1`, [id])
  return rows[0]
}

/** The distinct Saturdays (Sydney dates) the competition plays on, in order. */
export async function roundDates(pool) {
  return (await sql(pool, `
    select (f.starts_at at time zone 'Australia/Sydney')::date::text as d, min(f.round) as round, count(*)::int as games
      from public.fixtures f where f.competition_id = $1 and f.starts_at is not null
     group by 1 order by 1`, [COMP]))
}

/** The mirrored event of a fixture for one club (what its families open). */
export async function eventFor(pool, fixtureId, clubId) {
  return val(pool, `select id from public.events where fixture_id = $1 and academy_id = $2`, [fixtureId, clubId])
}

// -------------------------------------------------------------------- people
/** Who is around a squad: its coach, manager, the parents, the players. */
export async function squad(pool, teamId) {
  const [row] = await sql(pool, `
    select t.id, t.name, t.academy_id, t.age_group,
           (select tm.profile_id from public.team_members tm where tm.team_id = t.id and tm.role = 'coach' order by tm.created_at limit 1) as coach,
           (select cr.profile_id from public.club_roles cr where cr.team_id = t.id and cr.role = 'team_manager' limit 1) as manager,
           coalesce((select array_agg(tm.profile_id) from public.team_members tm where tm.team_id = t.id and tm.role = 'parent'), '{}') as parents,
           coalesce((select array_agg(pl.id order by pl.full_name) from public.players pl where pl.team_id = t.id), '{}') as players,
           (select c.id from public.channels c where c.team_id = t.id and c.type = 'team' and c.status = 'active' limit 1) as channel,
           (select e.id from public.competition_entries e where e.team_id = t.id and e.competition_id = $2 limit 1) as entry
      from public.teams t where t.id = $1`, [teamId, COMP])
  return row
}

/** A guardian of a player (the primary one). */
export const guardianOf = (pool, playerId) => val(pool, `select profile_id from public.player_guardians where player_id = $1 order by is_primary desc, profile_id limit 1`, [playerId])
export const playerName = (pool, playerId) => val(pool, `select full_name from public.players where id = $1`, [playerId])
export const entryOfTeam = (pool, teamId) => val(pool, `select id from public.competition_entries where team_id = $1 and competition_id = $2`, [teamId, COMP])

// --------------------------------------------------------------------- sheets
/** A team sheet from the entry's squad: the first `n` players (plus any extras), numbered. */
export async function sheetFor(pool, entryId, { n = 13, extra = [], skip = [] } = {}) {
  const rows = await sql(pool, `
    select s.player_id from public.entry_squads s join public.players p on p.id = s.player_id
     where s.entry_id = $1 and not (s.player_id = any($2::uuid[]))
       and not (s.player_id = any($4::uuid[]))
       -- a coach leaves a suspended player off (the scenarios put one on with \`extra\` to see the refusal)
       and not exists (select 1 from public.suspensions x where x.player_id = s.player_id and x.competition_id = s.competition_id and x.status = 'active' and x.served < x.games)
     order by p.full_name limit $3`, [entryId, skip, n, extra])
  const players = [...rows.map((r) => r.player_id), ...extra]
  return players.map((player_id, i) => ({ player_id, number: i + 1, starting: i < 11 }))
}

/** The coach submits the sheet for their side of a game. */
export async function submitSheet(pool, fixture, side, opts = {}) {
  const entry = side === 'home' ? fixture.home_entry_id : fixture.away_entry_id
  const team = side === 'home' ? fixture.home_team : fixture.away_team
  if (!entry || !team) return { ok: false, code: 'NOTEAM', error: 'no team behind this side' }
  const sq = await squad(pool, team)
  const players = await sheetFor(pool, entry, opts)
  const res = await rpc(pool, opts.as ?? sq.coach, 'submit_match_sheet', { p_fixture: fixture.id, p_entry: entry, p_players: JSON.stringify(players), p_captain: players[0]?.player_id ?? null, p_keeper: players[1]?.player_id ?? null })
  return { ...res, entry, coach: sq.coach, players }
}

/** Both managers enter a score (the same one unless `mismatch`). */
export async function enterScores(pool, fixture, home, away, { mismatch = false } = {}) {
  const h = await squad(pool, fixture.home_team)
  const a = await squad(pool, fixture.away_team)
  const r1 = await rpc(pool, h.manager ?? h.coach, 'enter_sheet_score', { p_fixture: fixture.id, p_entry: fixture.home_entry_id, p_ours: home, p_theirs: away })
  const r2 = await rpc(pool, a.manager ?? a.coach, 'enter_sheet_score', { p_fixture: fixture.id, p_entry: fixture.away_entry_id, p_ours: mismatch ? away + 1 : away, p_theirs: home })
  return { home: r1, away: r2 }
}

// --------------------------------------------------------------- the referee
/** The referee appointed (accepted) to a game, with their profile. */
export async function refereeOf(pool, fixtureId) {
  const [row] = await sql(pool, `
    select ap.id as appointment_id, ap.referee_id, ap.status, ap.checked_in_at, r.profile_id, r.full_name, r.under_18
      from public.referee_appointments ap join public.referees r on r.id = ap.referee_id
     where ap.fixture_id = $1 and ap.role = 'referee' and ap.status in ('offered', 'accepted') order by ap.offered_at desc limit 1`, [fixtureId])
  return row ?? null
}

// ------------------------------------------------------------------- the queue
/** Notification rows: by kind, person, event or message, since a moment. */
export async function queued(pool, { kind = null, profile = null, event = null, since = null, message = null, sent = null } = {}) {
  return sql(pool, `
    select id, profile_id, kind, title, body, scheduled_for, sent_at, escalate_sms, sms_sent_at, dedupe_key, payload, created_at
      from public.notification_queue n
     where ($1::text is null or n.kind = $1)
       and ($2::uuid is null or n.profile_id = $2)
       and ($3::uuid is null or n.payload->>'event_id' = $3::text)
       and ($4::timestamptz is null or n.created_at >= $4)
       and ($5::uuid is null or n.payload->>'message_id' = $5::text)
       and ($6::boolean is null or (n.sent_at is not null) = $6)
     order by n.created_at`, [kind, profile, event, since, message, sent])
}

/** Counts of queued notifications by kind since a moment. */
export async function queueTally(pool, since) {
  return sql(pool, `select kind, count(*)::int as n, count(*) filter (where sent_at is not null)::int as sent, count(*) filter (where escalate_sms)::int as sms
                      from public.notification_queue where created_at >= $1 group by kind order by n desc`, [since])
}

// ------------------------------------------------------------ cron and drain
/**
 * What pg_cron and the Netlify functions would do at this moment: the
 * sweeps (every few minutes in production), the morning ones once a day, and
 * the push drain — claim what is due, "send" it, mark it sent — plus the
 * SMS escalations. Returns what moved.
 */
const morningDone = new Set()
/** Knobs the scenarios turn: the drain can be "down" (the Netlify function not running). */
export const switches = { drainDown: false }
export async function sweep(pool) {
  const out = { reminders: 0, sheets: 0, duties: 0, matchday: 0, published: 0, fanned: 0, morning: 0, sent: 0, sms: 0, claimed: 0 }
  await asAdmin(pool, async (c) => {
    out.reminders = (await c.query('select public.enqueue_event_reminders() n')).rows[0].n
    out.sheets = (await c.query('select public.queue_team_sheet_reminders(now()) n')).rows[0].n
    out.duties = (await c.query('select public.queue_duty_reminders(now()) n')).rows[0].n
    out.matchday = (await c.query('select public.queue_match_day_pushes() n')).rows[0].n
    out.published = (await c.query('select public.publish_scheduled_messages() n')).rows[0].n
    for (let i = 0; i < 8; i++) {
      const n = (await c.query('select public.fan_out_club_messages() n')).rows[0].n
      out.fanned += n
      if (n === 0) break
    }
    // The 06:15 Sydney sweeps, once per simulated day.
    const local = clock.local()
    const day = local.slice(0, 10)
    if (local.slice(11, 16) >= '06:15' && !morningDone.has(day)) {
      morningDone.add(day)
      for (const fn of ['queue_clearance_warnings', 'queue_official_rego_reminders', 'queue_fee_reminders', 'queue_accreditation_warnings', 'queue_entry_fee_reminders']) {
        out.morning += (await c.query(`select public.${fn}() n`)).rows[0].n
      }
    }
  })
  if (!switches.drainDown) Object.assign(out, await drain(pool))
  return out
}

/** The drain (lib/push/drain.ts), minus the network: claimed rows are sent to a phone that always says yes. */
export async function drain(pool) {
  const out = { claimed: 0, sent: 0, sms: 0 }
  await asAdmin(pool, async (c) => {
    for (let pass = 0; pass < 20; pass++) {
      const { rows } = await c.query('select id from public.claim_notifications(500)')
      if (rows.length === 0) break
      out.claimed += rows.length
      const r = await c.query('update public.notification_queue set sent_at = now() where id = any($1::uuid[]) and sent_at is null', [rows.map((x) => x.id)])
      out.sent += r.rowCount
      if (rows.length < 500) break
    }
    const { rows: sms } = await c.query('select id from public.claim_sms_escalations(200)')
    if (sms.length) {
      await c.query('update public.notification_queue set sms_sent_at = now() where id = any($1::uuid[])', [sms.map((x) => x.id)])
      out.sms = sms.length
    }
  })
  return out
}

/**
 * Move the clock to a Sydney wall-clock time, in quarter-hour ticks, running
 * the sweeps at each tick (as the crons would). Returns the sweeps' totals.
 */
export async function advanceTo(pool, local, { tickMinutes = 15, onTick = null } = {}) {
  const target = sydney(local)
  const totals = {}
  if (!clock.now) clock.now = target
  let guard = 0
  while (clock.now < target && guard++ < 20000) {
    const next = new Date(Math.min(target.getTime(), clock.now.getTime() + tickMinutes * 60_000))
    clock.now = next
    const t = await sweep(pool)
    for (const [k, v] of Object.entries(t)) totals[k] = (totals[k] ?? 0) + v
    if (onTick) await onTick(t)
  }
  clock.now = target
  return totals
}

// --------------------------------------------------------------------- chat
/** A line in a channel, as a person (through RLS). */
export function say(pool, profile, channelId, academyId, body, extra = {}) {
  const cols = ['academy_id', 'channel_id', 'sender_id', 'body']
  const vals = [academyId, channelId, profile, body]
  for (const [k, v] of Object.entries(extra)) { cols.push(k); vals.push(v) }
  return run(pool, profile, `insert into public.messages (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)
}

export async function react(pool, profile, messageId, academyId, emoji = '👍') {
  return run(pool, profile, `insert into public.message_reactions (academy_id, message_id, profile_id, emoji) values ($1, $2, $3, $4) on conflict do nothing returning id`, [academyId, messageId, profile, emoji])
}

/** An RSVP by a parent for their child. */
export function rsvp(pool, profile, academyId, eventId, playerId, status = 'yes') {
  return run(pool, profile, `insert into public.event_rsvps (academy_id, event_id, profile_id, player_id, status) values ($1, $2, $3, $4, $5)
    on conflict (event_id, profile_id, player_id) do update set status = excluded.status returning id`, [academyId, eventId, profile, playerId, status])
}

/** The notices channel of the competition. */
export const noticesChannel = (pool) => val(pool, `select id from public.channels where type = 'notices' and competition_id = $1`, [COMP])
export const clubsChannel = (pool) => val(pool, `select id from public.channels where type = 'clubs' and competition_id = $1`, [COMP])

// ------------------------------------------------------------------- ladders
export async function ladder(pool, division, as = ids.leagueOwner) {
  const r = await rpc(pool, as, 'competition_ladder', { p_competition: COMP, p_division: division })
  return r.ok ? r.data ?? [] : []
}

/** The game's local date + time helper for scheduling scenario moments. */
export const localDateOf = (fixture) => sydneyDate(new Date(fixture.starts_at))

/** A Sydney time on the fixture's day: `at(fixture, '07:00')`. */
export const at = (fixture, hhmm) => `${localDateOf(fixture)} ${hhmm}`

/** Minutes before/after kick-off as a Sydney wall-clock string. */
export function kickoffPlus(fixture, minutes) {
  const d = new Date(new Date(fixture.starts_at).getTime() + minutes * 60_000)
  const s = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const g = (k) => s.find((x) => x.type === k)?.value
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

export { asPerson, rpc, run, sql, val }
