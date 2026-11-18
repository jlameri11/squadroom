// Joey's scenario list (13 Nov 2026), as things that happen in the season.
// Each `scenario(id, group, title)` runs its checks (expected vs actual) with
// `check`, `mustWork` and `mustRefuse`; a failed check logs a bug. The season
// driver (season.mjs) asks for the pre-season steps, each round's extra
// steps, and the finals.
import { asAnon, check, clock, focus, ids, mustRefuse, mustWork, note, ok, rpc, run, scenario, scenarios, sql, val, who } from './lib.mjs'
import { COMP, LEAGUE, gamesOn, ladder, squad, val as v } from './world.mjs'
import * as rounds from './scenarios-rounds.mjs'
import { runScreens } from './screens.mjs'
import * as rounds2 from './scenarios-rounds2.mjs'
import * as extra from './scenarios-extra.mjs'
import { rng } from './routine.mjs'

const DIVISIONS_BY_VENUE = (division) => {
  const m = /^(U\d+) Division (\d+)$/.exec(division)
  const age = m[1], k = Number(m[2])
  if (age === 'U17') return 9 + k // venues 10–12
  return k // U9 1–9, U11/U13 1–10, U15 1–7
}

/** Does a public function take a parameter of this name? (The fixes add parameters; the scenario adapts.) */
export async function hasParam(pool, fn, param) {
  const args = await val(pool, `select pg_get_function_identity_arguments(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1 limit 1`, [fn])
  return (args ?? '').includes(param)
}

// ================================================================ pre-season
export async function preseason(ctx) {
  // Joey (16 Nov): a brand-new organiser starts a league from sign-up to a published draw, timed — the week before.
  await extra.leagueSetup(ctx)
  const { pool } = ctx
  ctx.needsJoey = ctx.needsJoey ?? []

  // ---- OFF5b. A club enters late (the public enter page, decided by the league).
  {
    scenario('OFF5b', 'Off-field issues', 'A club enters late')
    const open = await run(pool, who.compManager, `update public.competitions set entries_open = true where id = $1 returning id`, [COMP])
    mustWork(open, { what: 'the competition manager opens entries', role: 'competition manager', where: 'competitions' })
    // The public enter page posts to /api/competitions/enter, which calls this with the service role.
    let req
    try {
      req = { ok: true, data: await val(pool, `select public.request_competition_entry('spl-season-4', 'Harbour Wanderers', 'Harbour Wanderers U13', 'U13 Division 10', 'Pat Secretary', '+61400999000', 'secretary@wanderers.sim.test', 'Late, sorry — our AGM was last week', 'iphash-1')`) }
    } catch (e) { req = { ok: false, code: e.code, error: e.message } }
    mustWork(req, { what: 'a stranger asks to enter a team through the public page (the route, as the server)', role: 'stranger', where: 'request_competition_entry' })
    if (req.ok) {
      const dec = await rpc(pool, who.compManager, 'decide_entry_request', { p_request: req.data, p_accept: true, p_division: 'U13 Division 10', p_note: 'Welcome' })
      mustWork(dec, { what: 'the competition manager accepts the late entry', role: 'competition manager', where: 'decide_entry_request' })
      const entry = dec.data?.entry_id
      ctx.lateEntry = entry
      const fee = await val(pool, `select status from public.entry_fees where entry_id = $1`, [entry])
      check(fee === 'owed', { what: 'the late entry owes its entry fee from the moment it exists', expected: 'owed', actual: fee, role: 'league treasurer', where: 'entry_fees (raise_entry_fee)' })
      const inDraw = await val(pool, `select count(*)::int from public.competition_entries where competition_id = $1 and division = 'U13 Division 10'`, [COMP])
      check(inDraw === 9, { what: 'U13 Division 10 now has nine teams', expected: 9, actual: inDraw, role: 'competition manager', where: 'competition_entries' })
    }
    await run(pool, who.compManager, `update public.competitions set entries_open = false where id = $1`, [COMP])
  }

  // ---- The league's referee rules for the season.
  {
    const rules = await rpc(pool, who.refCoordinator, 'set_referee_rules', { p_competition: COMP, p_late_decline_hours: 24, p_self_appoint: true, p_grades: ['A', 'B'], p_club_allocate_hours: 24 })
    if (!rules.ok) note(`set_referee_rules: ${rules.error}`)
  }

  // ---- S1. The draw: 14 rounds (home and away), byes where a division is odd, a bye week in the school holidays.
  {
    scenario('S1', 'Season build', 'The draw: 14 rounds home and away, a bye week in the school holidays')
    const divisions = await sql(pool, `select division, age_group, pitch_size from public.competition_divisions where competition_id = $1 order by rank`, [COMP])
    const legs = await hasParam(pool, 'generate_fixtures_on_pitches', 'p_legs')
    const skip = await hasParam(pool, 'generate_fixtures_on_pitches', 'p_skip_dates')
    let made = 0, overflow = 0, failed = []
    for (const d of divisions) {
      const venue = ids.venue(DIVISIONS_BY_VENUE(d.division))
      const args = { p_competition: COMP, p_division: d.division, p_venue: venue, p_first_date: '2027-02-06', p_game_mins: null, p_gap_mins: 5, p_replace: false, p_round_every_days: 7 }
      const teams = await val(pool, `select count(*)::int from public.competition_entries where competition_id = $1 and division = $2`, [COMP, d.division])
      // A nine-team division has nine rounds a leg: one leg fits the season, two would run past the finals.
      if (legs) args.p_legs = teams >= 9 ? 1 : 2
      if (skip) args.p_skip_dates = ['2027-04-17']
      const r = await rpc(pool, who.compManager, 'generate_fixtures_on_pitches', args)
      if (!r.ok) { failed.push(`${d.division}: ${r.error}`); continue }
      made += r.data.games; overflow += r.data.overflow
    }
    check(failed.length === 0, { what: 'every division gets a draw on its ground', expected: 'all 39 drawn', actual: failed.join(' · ') || 'all drawn', role: 'competition manager', where: 'generate_fixtures_on_pitches' })
    check(overflow === 0, { what: 'every drawn game fits a pitch within its hours', expected: '0 overflow', actual: `${overflow} games found no slot`, role: 'competition manager', where: 'generate_fixtures_on_pitches', severity: 'medium' })
    const rounds14 = await val(pool, `select count(distinct round)::int from public.fixtures where competition_id = $1 and division = 'U11 Division 1'`, [COMP])
    if (!legs) {
      // The product makes one round robin. A second run makes "Round 1" to "Round 7" again — a league cannot draw a home-and-away season.
      const again = await rpc(pool, who.compManager, 'generate_fixtures_on_pitches', { p_competition: COMP, p_division: 'U11 Division 1', p_venue: ids.venue(1), p_first_date: '2027-03-27', p_game_mins: null, p_gap_mins: 5, p_replace: false, p_round_every_days: 7 })
      const labels = await sql(pool, `select round, count(*)::int n from public.fixtures where competition_id = $1 and division = 'U11 Division 1' group by round order by round`, [COMP])
      check(false, { what: 'the generator can draw the second half of the season (rounds 8–14, home and away reversed)', expected: 'rounds 1–14 from one draw', actual: `one run makes ${rounds14} rounds; a second run (${again.ok ? 'allowed' : again.error}) labels them ${labels.map((l) => `${l.round} ×${l.n}`).join(', ')}`, role: 'competition manager', where: 'generate_fixtures / generate_fixtures_managed', severity: 'medium' })
      // Undo the second run so the season is at least consistent: the duplicate labels go.
      await sql(pool, `delete from public.fixtures where competition_id = $1 and division = 'U11 Division 1' and starts_at >= timestamptz '2027-03-27 00:00+11'`, [COMP])
    } else {
      check(rounds14 === 14, { what: 'an eight-team division has fourteen rounds', expected: 14, actual: rounds14, role: 'competition manager', where: 'generate_fixtures p_legs' })
      const swapped = await val(pool, `
        with pairs as (
          select least(home_entry_id, away_entry_id) a, greatest(home_entry_id, away_entry_id) b, home_entry_id, round
            from public.fixtures where competition_id = $1 and division = 'U11 Division 1')
        select count(*)::int from pairs p1 join pairs p2 on p1.a = p2.a and p1.b = p2.b and p1.round < p2.round
         where p1.home_entry_id = p2.home_entry_id`, [COMP])
      check(swapped === 0, { what: 'the second leg reverses home and away', expected: '0 pairs with the same home side twice', actual: swapped, role: 'competition manager', where: 'generate_fixtures p_legs' })
    }
    const onHoliday = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and (starts_at at time zone 'Australia/Sydney')::date = date '2027-04-17'`, [COMP])
    check(onHoliday === 0, { what: 'no round falls on the school-holiday Saturday (17 April)', expected: 0, actual: `${onHoliday} games on 17 April${skip ? '' : ' — the generator has no way to leave a week out'}`, role: 'competition manager', where: 'generate_fixtures p_round_every_days', severity: 'medium' })
    const dates = await sql(pool, `select (starts_at at time zone 'Australia/Sydney')::date::text d, count(*)::int n from public.fixtures where competition_id = $1 group by 1 order by 1`, [COMP])
    note(`draw: ${made} games on ${dates.length} days — ${dates.map((x) => `${x.d.slice(5)}:${x.n}`).join(' ')}`)
    ctx.drawDates = dates
  }

  // ---- S2. The sanity check before publishing: pairs, clashes, double-headers, empty slots.
  {
    scenario('S2', 'Season build', 'The sanity check on the draw: every pair once a leg, no coach in two games, families at two grounds as a warning, no double-headers')
    const qs = []
    for (const d of ['U9 Division 1', 'U11 Division 1', 'U13 Division 10', 'U15 Division 1', 'U17 Division 1']) {
      const q = await rpc(pool, who.compManager, 'draw_quality', { p_competition: COMP, p_division: d })
      if (q.ok && q.data) qs.push({ d, ...q.data })
    }
    const uneven = qs.filter((q) => (q.pairs?.uneven ?? []).length > 0)
    check(uneven.length === 0, { what: 'every pair meets the same number of times in each division', expected: 'no uneven pairs', actual: uneven.map((q) => `${q.d}: ${q.pairs.uneven.length} uneven (${q.pairs.min}–${q.pairs.max})`).join('; ') || 'none', role: 'competition manager', where: 'draw_quality', severity: 'medium' })
    // Joey's rule (15 Nov 2026): two squads of one club at once is fine; a coach or manager in two games is not.
    const staff = qs.filter((q) => (q.staff_clashes ?? []).length > 0)
    check(staff.length === 0, { what: 'no coach or team manager is drawn into two games that overlap (with travel between grounds)', expected: 'none', actual: staff.map((q) => `${q.d}: ${q.staff_clashes.length} (${q.staff_clashes[0]?.person})`).join('; ') || 'none', role: 'competition manager', where: 'generate_fixtures / draw_quality (staff_clashes)' })
    const fam = qs.reduce((n, q) => n + (q.family_clashes ?? []).length, 0)
    note(`families with children at two grounds at once (a warning, kept down): ${fam} across the sampled divisions`)
    check(qs.every((q) => Array.isArray(q.family_clashes)), { what: 'the draw check lists families at two grounds at once as a warning', expected: 'a family_clashes list', actual: qs.map((q) => `${q.d}: ${(q.family_clashes ?? []).length}`).join(', '), role: 'competition manager', where: 'draw_quality (family_clashes)', severity: 'low' })
    const dh = qs.filter((q) => (q.double_headers ?? []).length > 0)
    check(dh.length === 0, { what: 'no team plays twice in a day in the drawn season', expected: 'none', actual: dh.map((q) => `${q.d}: ${q.double_headers.length}`).join('; ') || 'none', role: 'competition manager', where: 'draw_quality' })
  }

  // ---- FV1. Pitch allocation by age-group size; FV3 hours.
  {
    scenario('FV1', 'Fields & venues', 'Pitch allocation by age-group size')
    const wrong = await sql(pool, `
      select f.division, p.size, d.pitch_size, count(*)::int n
        from public.fixtures f join public.pitches p on p.id = f.pitch_id
        join public.competition_divisions d on d.competition_id = f.competition_id and d.division = f.division
       where f.competition_id = $1 and p.size <> d.pitch_size group by 1, 2, 3`, [COMP])
    check(wrong.length === 0, { what: 'every game is on a pitch of its division\'s size (U9 quarters, U11/U13 halves, U15/U17 full)', expected: 'none wrong', actual: wrong.map((w) => `${w.division} on ${w.size} ×${w.n}`).join('; ') || 'none', role: 'ground manager', where: 'generate_fixtures_on_pitches' })
    const unplaced = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1 and pitch_id is null`, [COMP])
    check(unplaced === 0, { what: 'every game has a pitch', expected: 0, actual: unplaced, role: 'ground manager', where: 'fixtures.pitch_id' })
    scenario('FV3', 'Fields & venues', 'Hours limits: nothing drawn outside a pitch\'s hours, and a move outside them is refused')
    const outside = await val(pool, `select count(*)::int from public.fixtures f where f.competition_id = $1 and f.pitch_id is not null and not app_private.pitch_open(f.pitch_id, f.starts_at, f.starts_at + make_interval(mins => coalesce(f.duration_mins, 60)))`, [COMP])
    check(outside === 0, { what: 'no drawn game sits outside its pitch\'s hours', expected: 0, actual: outside, role: 'ground manager', where: 'pitch_open' })
    const g = (await gamesOn(pool, '2027-02-06'))[0]
    const late = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: g.id, p_starts_at: new Date('2027-02-06T22:00:00+11:00').toISOString(), p_venue_label: null, p_field: null })
    mustRefuse(late, { what: 'moving a game to 10 pm on a ground that closes at 6 is refused', role: 'ground manager', where: 'reschedule_fixture → guard_pitch_booking' })
  }

  // ---- FV2. Full pitches split into halves / thirds / quarters.
  {
    scenario('FV2', 'Fields & venues', 'A full pitch split into halves, thirds or quarters')
    const spare = await rpc(pool, who.grounds, 'add_pitch', { p_venue: ids.venue(1), p_name: 'Field 3' })
    mustWork(spare, { what: 'the ground manager adds Field 3 at Harbour Park', role: 'ground manager', where: 'add_pitch' })
    if (spare.ok) {
      const thirds = await rpc(pool, who.grounds, 'split_pitch', { p_pitch: spare.data, p_into: 3 })
      mustWork(thirds, { what: 'and cuts it into thirds', role: 'ground manager', where: 'split_pitch' })
      const kids = await sql(pool, `select name, size from public.pitches where parent_id = $1 order by sort, name`, [spare.data])
      check(kids.length === 3 && kids.every((k) => k.size === 'third'), { what: 'three thirds appear under Field 3', expected: '3 thirds', actual: kids.map((k) => `${k.name} ${k.size}`).join(', '), role: 'ground manager', where: 'pitches' })
      const halves = await val(pool, `select count(*)::int from public.pitches where venue_id = $1 and size = 'half'`, [ids.venue(1)])
      const quarters = await val(pool, `select count(*)::int from public.pitches where venue_id = $1 and size = 'quarter'`, [ids.venue(1)])
      check(halves === 2 && quarters === 4, { what: 'Harbour Park has its halves and quarters from the venue layout', expected: '2 halves, 4 quarters', actual: `${halves} halves, ${quarters} quarters`, role: 'ground manager', where: 'pitches' })
      ctx.field3 = spare.data
    }
  }

  // ---- FV4. Double-booking refused.
  {
    scenario('FV4', 'Fields & venues', 'Double-booking a pitch is refused')
    const [a, b] = await sql(pool, `select id, starts_at, pitch_id from public.fixtures where competition_id = $1 and pitch_id = (select pitch_id from public.fixtures where competition_id = $1 and (starts_at at time zone 'Australia/Sydney')::date = '2027-02-06' and pitch_id is not null group by pitch_id having count(*) >= 2 limit 1) and (starts_at at time zone 'Australia/Sydney')::date = '2027-02-06' order by starts_at limit 2`, [COMP])
    if (a && b) {
      const clash = await rpc(pool, who.grounds, 'reschedule_fixture', { p_fixture: b.id, p_starts_at: a.starts_at.toISOString(), p_venue_label: null, p_field: null })
      mustRefuse(clash, { what: 'moving a game onto a slot its pitch already has is refused, naming the booking', role: 'ground manager', where: 'reschedule_fixture → pitch_clash' })
      if (!clash.ok) check(/booked/.test(clash.error), { what: 'the refusal says which game has the pitch', expected: 'names the booking', actual: clash.error, role: 'ground manager', where: 'pitch_clash', severity: 'low' })
    } else {
      check(false, { what: 'two games on one pitch on day one to test with', expected: 'found', actual: 'none', role: '—', where: 'fixtures', quiet: true })
    }
  }

  // ---- OFF7a. Daylight saving: kick-off times after the clocks change (4 April 2027).
  {
    scenario('OFF7a', 'Off-field issues', 'Daylight saving: the same kick-off time on the clock after the change')
    const rows = await sql(pool, `
      select f.division, min(to_char(f.starts_at at time zone 'Australia/Sydney', 'HH24:MI')) filter (where (f.starts_at at time zone 'Australia/Sydney')::date = '2027-03-27') as before,
             min(to_char(f.starts_at at time zone 'Australia/Sydney', 'HH24:MI')) filter (where (f.starts_at at time zone 'Australia/Sydney')::date = '2027-04-10') as after
        from public.fixtures f where f.competition_id = $1 group by f.division order by f.division`, [COMP])
    const both = rows.filter((r) => r.before && r.after)
    const drift = both.filter((r) => r.before !== r.after)
    check(both.length > 0 && drift.length === 0, { what: 'a division\'s first kick-off reads the same on 27 March and 10 April (the clocks change on 4 April)', expected: 'no drift', actual: !both.length ? 'no division plays on both dates (no second leg)' : drift.length ? drift.slice(0, 3).map((r) => `${r.division} ${r.before}→${r.after}`).join(', ') + (drift.length > 3 ? ` +${drift.length - 3}` : '') : 'none', role: 'competition manager', where: 'generate_fixtures_managed (round dates in days, in the session\'s zone)', severity: 'medium' })
  }

  // ---- Squads behind every entry.
  {
    const entries = await sql(pool, `select e.id, e.academy_id from public.competition_entries e where e.competition_id = $1 and e.team_id is not null`, [COMP])
    let n = 0
    // The president of each club seeds every one of its squads.
    const clubs = await sql(pool, `select distinct e.academy_id from public.competition_entries e where e.competition_id = $1 and e.team_id is not null`, [COMP])
    for (const cl of clubs) {
      const pres = await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'owner' limit 1`, [cl.academy_id])
      const mine = entries.filter((e) => e.academy_id === cl.academy_id)
      for (const e of mine) {
        const r = await rpc(pool, pres, 'seed_entry_squad', { p_entry: e.id })
        if (r.ok) n += r.data
      }
    }
    note(`${n} players on entry squads`)
  }

  // ---- Payments and programs the money scenarios lean on (OFF4).
  await rounds.setupMoney(ctx)
  // ---- Duties the volunteer scenarios lean on (OFF6).
  await rounds.setupDuties(ctx)
  // ---- The first screen check: the draw is out (Sunday afternoon, before round 1's week begins at 18:00).
  clock.set('2027-01-31 17:00')
  await runScreens(ctx, 'draw')
  ok('pre-season done')
}

// ===================================================================== rounds
/** A step's checks belong to the scenario its name starts with ("OF1 …" → OF1, "FV9a …" → FV9) unless the step names one itself. */
function stepAdder(plan) {
  return (at, name, fn) => plan.push({ at, name, run: async () => {
    const m = /^([A-Z]+\d+[a-z]?)/.exec(name)
    if (m) { if (!focus(m[1])) focus(m[1].replace(/[a-z]$/, '')) }
    return fn()
  } })
}

export async function roundPlan(ctx, r, S) {
  const plan = []
  const add = stepAdder(plan)
  await rounds.everyRound(ctx, r, S, add)
  // Joey's list of 16 Nov (files, families joining, role requests, Stripe test mode, two devices,
  // admin mistakes, feature switches, a family's data): each group has its round.
  await extra.extraPlan(ctx, r, S, add, rng(ctx.seed * 1000 + 500 + r))
  switch (r) {
    case 1: await rounds.round1(ctx, S, add); break
    case 2: await rounds.round2(ctx, S, add); break
    case 3: await rounds.round3(ctx, S, add); break
    case 4: await rounds.round4(ctx, S, add); break
    case 5: await rounds.round5(ctx, S, add); break
    case 6: await rounds.round6(ctx, S, add); break
    case 7: await rounds.round7(ctx, S, add); break
    case 8: await rounds2.round8(ctx, S, add); break
    case 9: await rounds2.round9(ctx, S, add); break
    case 10: await rounds2.round10(ctx, S, add); break
    case 11: await rounds2.round11(ctx, S, add); break
    case 12: await rounds2.round12(ctx, S, add); break
    case 13: await rounds2.round13(ctx, S, add); break
    case 14: await rounds2.round14(ctx, S, add); break
    default: break
  }
  return plan
}

export async function finalsPlan(ctx) {
  const plan = []
  const add = stepAdder(plan)
  await rounds2.finals(ctx, add)
  return plan
}

export async function closing(ctx) {
  await rounds2.closing(ctx)
}
