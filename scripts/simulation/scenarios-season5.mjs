// The second simulated season (Joey, 15 Nov 2026: past seasons + head to
// head). After Season 4's grand final the league ends the season, the clubs
// roll their squads over to 2028 (R-19 lineage), the league starts SPL
// Season 5 from Season 4 and draws it, and the first rounds are played. Then:
//   PS1 — Season 4 is still reachable from every place: the public match
//         centre's season switcher, the competition page, Fixtures, a team's
//         history; nothing deleted; every write to it refused.
//   HH1 — head to head on a Season 5 game shows this season's meetings and
//         both legs from Season 4, scores hidden where the division hides them.
import { check, clock, ids, mustRefuse, mustWork, note, rpc, run, scenario, sql, val, who, asAnon } from './lib.mjs'
import { COMP, LEAGUE, advanceTo, eventFor, gamesOn, guardianOf, setCompetition, squad } from './world.mjs'
import { runScreens } from './screens.mjs'

export const SEASON5 = { name: 'SPL Season 5', season: '2028', slug: 'spl-season-5', first: '2028-02-05', rounds: 3 }

export async function season5Plan(ctx, add) {
  const { pool } = ctx
  const comp4 = COMP

  add('2027-06-06 10:00', 'PS1 the league ends Season 4: read-only from here', async () => {
    scenario('PS1', 'Past seasons', 'Past seasons are always visitable: nothing deleted, read-only, reachable from the match centre, the competition page, Fixtures and a team\'s history')
    const g = (await sql(pool, `select f.* from public.fixtures f where f.competition_id = $1 and f.status = 'final' and f.stage is distinct from 'final' order by f.starts_at desc limit 1`, [comp4]))[0]
    const end = await rpc(pool, who.compManager, 'end_season', { p_competition: comp4 })
    mustWork(end, { what: 'the competition manager ends the season', role: 'competition manager', where: 'end_season' })
    const st = await val(pool, `select status::text from public.competitions where id = $1`, [comp4])
    check(st === 'ended', { what: 'the competition reads as ended', expected: 'ended', actual: st, role: 'league', where: 'competitions' })
    if (g) {
      const hs = await squad(pool, (await val(pool, `select team_id from public.competition_entries where id = $1`, [g.home_entry_id])))
      const w = await rpc(pool, hs.manager ?? hs.coach, 'enter_sheet_score', { p_fixture: g.id, p_entry: g.home_entry_id, p_ours: 9, p_theirs: 9 })
      mustRefuse(w, { what: 'a score cannot be changed in a finished season', role: 'manager', where: 'refuse_when_season_over (match_sheets)' })
      const rl = await rpc(pool, who.compManager, 'rule_on_score', { p_fixture: g.id, p_home: 9, p_away: 9, p_note: 'late', p_pens_home: null, p_pens_away: null })
      mustRefuse(rl, { what: 'nor by the league without reopening it', role: 'competition manager', where: 'refuse_when_season_over (fixtures)' })
      const del = await run(pool, who.compManager, `delete from public.fixtures where id = $1 returning id`, [g.id])
      mustRefuse(del, { what: 'a finished season\'s game cannot be deleted', role: 'competition manager', where: 'refuse_when_season_over (delete)' })
      const delComp = await run(pool, who.compManager, `delete from public.competitions where id = $1 returning id`, [comp4])
      mustRefuse(delComp, { what: 'nor the competition itself', role: 'competition manager', where: 'refuse_when_season_over (competitions)' })
      const still = await val(pool, `select count(*)::int from public.fixtures where competition_id = $1`, [comp4])
      check(still > 2000, { what: 'every game of the season is still there', expected: '>2000', actual: still, role: 'league', where: 'fixtures' })
      // Reopen, correct, end again: the league's way through.
      const ro = await rpc(pool, who.compManager, 'reopen_season', { p_competition: comp4, p_note: 'one correction' })
      mustWork(ro, { what: 'the league can reopen it for a correction', role: 'competition manager', where: 'reopen_season' })
      const again = await rpc(pool, who.compManager, 'end_season', { p_competition: comp4 })
      mustWork(again, { what: 'and end it again', role: 'competition manager', where: 'end_season' })
    }
    ctx.needsJoey?.push('A withdrawn team and a finished season show on the ladder and the match centre without a label yet (the data is marked; the screens could say "withdrew" and "final").')
  })

  // The off-season: every club rolls its squads up an age group into 2028.
  add('2027-06-07 10:00', 'the clubs roll over to 2028; the league starts Season 5', async () => {
    let rolled = 0, failed = []
    for (let c = 1; c <= 60; c++) {
      const r = await rpc(pool, who.president(c), 'roll_over_season', { p_academy: ids.club(c), p_from: '2027', p_to: '2028', p_plan: null })
      if (r.ok) rolled += r.data?.teams ?? 0; else failed.push(`${c}: ${r.error}`)
    }
    note(`${rolled} squads rolled over to 2028${failed.length ? `; failed: ${failed.slice(0, 3).join(' | ')}` : ''}`)
    const ns = await rpc(pool, who.compManager, 'new_season_from', { p_competition: comp4, p_name: SEASON5.name, p_season: SEASON5.season, p_starts_on: SEASON5.first, p_ends_on: '2028-06-03', p_slug: SEASON5.slug })
    mustWork(ns, { what: 'the league starts Season 5 from Season 4', role: 'competition manager', where: 'new_season_from' })
    if (!ns.ok) return
    ctx.comp5 = ns.data.competition_id
    check(ns.data.entries >= 280, { what: 'the teams that rolled over keep their places', expected: '≥280 entries', actual: ns.data.entries, role: 'competition manager', where: 'new_season_from' })
    const lineage = await val(pool, `select count(*)::int from public.competition_entries e5 join public.teams t5 on t5.id = e5.team_id join public.competition_entries e4 on e4.team_id = t5.rolled_from and e4.competition_id = $2 where e5.competition_id = $1`, [ctx.comp5, comp4])
    check(lineage === ns.data.entries, { what: 'every Season 5 entry is a Season 4 team by lineage (U11 Red 2027 → U12 Red 2028)', expected: ns.data.entries, actual: lineage, role: 'league', where: 'teams.rolled_from' })
    return { rolled, entries: ns.data.entries }
  })

  add('2028-01-24 09:00', 'Season 5: squads and the draw', async () => {
    if (!ctx.comp5) return
    setCompetition(ctx.comp5)
    const divisions = await sql(pool, `select division from public.competition_divisions where competition_id = $1 order by rank`, [ctx.comp5])
    let made = 0
    for (const d of divisions) {
      const m = /^(U\d+) Division (\d+)$/.exec(d.division)
      const venue = ids.venue(m[1] === 'U17' ? 9 + Number(m[2]) : Number(m[2]))
      const teams = await val(pool, `select count(*)::int from public.competition_entries where competition_id = $1 and division = $2`, [ctx.comp5, d.division])
      if (teams < 2) continue
      const r = await rpc(pool, who.compManager, 'generate_fixtures_on_pitches', { p_competition: ctx.comp5, p_division: d.division, p_venue: venue, p_first_date: SEASON5.first, p_game_mins: null, p_gap_mins: 5, p_replace: false, p_round_every_days: 7, p_legs: 1, p_skip_dates: null })
      if (r.ok) made += r.data.games
    }
    const entries = await sql(pool, `select e.id, e.academy_id from public.competition_entries e where e.competition_id = $1 and e.team_id is not null`, [ctx.comp5])
    let squads = 0
    for (const e of entries) {
      const pres = await val(pool, `select profile_id from public.academy_members where academy_id = $1 and role = 'owner' limit 1`, [e.academy_id])
      const r = await rpc(pool, pres, 'seed_entry_squad', { p_entry: e.id })
      if (r.ok) squads += r.data
    }
    // Only the first three rounds are played: enough to meet last season's opponents.
    ctx.stopAfter = '2028-02-19'
    return { games: made, squads }
  })

  add('2028-02-01 09:00', 'PS1 Season 4 is reachable from every place', async () => {
    scenario('PS1', 'Past seasons', 'Past seasons are always visitable: nothing deleted, read-only, reachable from the match centre, the competition page, Fixtures and a team\'s history')
    if (!ctx.comp5) return
    // The public match centre: the switcher lists both; Season 4's page still has its games, ladders and finals.
    const seasons = await asAnon(pool, async (c) => (await c.query(`select public.public_competition_seasons('spl-season-5') j`)).rows[0].j)
    check(seasons.ok && (seasons.data ?? []).some((s) => s.slug === 'spl-season-4') && (seasons.data ?? []).some((s) => s.slug === 'spl-season-5' && s.current), { what: 'the match centre\'s season switcher lists Season 4 beside Season 5', expected: 'both', actual: JSON.stringify(seasons.data ?? seasons.error).slice(0, 160), role: 'stranger', where: 'public_competition_seasons' })
    const centre4 = await asAnon(pool, async (c) => (await c.query(`select public.public_match_centre('spl-season-4') j`)).rows[0].j)
    const fx4 = centre4.data?.fixtures ?? []
    const finals4 = fx4.filter((f) => /Final/.test(f.round ?? '') && f.status === 'final')
    check(fx4.length > 2000 && finals4.length >= 4 && Object.keys(centre4.data?.ladder ?? {}).length >= 20, { what: 'Season 4\'s public page still shows every game, the finals and the ladders', expected: '>2000 games, ≥4 finals, ≥20 ladders', actual: `${fx4.length} games, ${finals4.length} finals, ${Object.keys(centre4.data?.ladder ?? {}).length} ladders`, role: 'stranger', where: 'public_match_centre' })
    check((centre4.data?.ladder ?? {})['U9 Division 1'] === undefined, { what: 'and still no U9 ladder', expected: 'none', actual: 'U9 Division 1' in (centre4.data?.ladder ?? {}) ? 'a ladder' : 'none', role: 'stranger', where: 'public_match_centre' })
    // The competition page in the app: a parent's season switcher.
    const parent = ids.parent(1, 1)
    const cs = await rpc(pool, parent, 'competition_seasons', { p_competition: ctx.comp5 })
    check(cs.ok && (cs.data ?? []).some((s) => s.id === comp4 && s.status === 'ended'), { what: 'a parent\'s competition page lists Season 4 as finished', expected: 'Season 4, ended', actual: JSON.stringify(cs.data ?? cs.error).slice(0, 160), role: 'parent', where: 'competition_seasons' })
    const lad4 = await rpc(pool, parent, 'competition_ladder', { p_competition: comp4, p_division: 'U11 Division 1' })
    check(lad4.ok && (lad4.data ?? []).length === 8 && lad4.data.every((r) => r.played >= 12), { what: 'Season 4\'s U11 Division 1 ladder reads in full in the app', expected: '8 teams, 14 played', actual: lad4.ok ? `${(lad4.data ?? []).length} teams, played ${lad4.data?.[0]?.played}` : lad4.error, role: 'parent', where: 'competition_ladder' })
    // Fixtures: the family's 2027 season, results included.
    const ms = await rpc(pool, parent, 'my_seasons', { p_academy: ids.club(1) })
    check(ms.ok && (ms.data ?? []).some((s) => s.season === '2027') && (ms.data ?? []).some((s) => s.season === '2028'), { what: 'Fixtures offers 2027 beside 2028 to a family', expected: '2027 and 2028', actual: JSON.stringify(ms.data ?? ms.error), role: 'parent', where: 'my_seasons' })
    const sf = await rpc(pool, parent, 'season_fixtures', { p_academy: ids.club(1), p_season: '2027' })
    const played = (sf.data?.events ?? []).filter((e) => e.status === 'final' && (e.ours != null || e.scores_hidden))
    check(sf.ok && (sf.data?.events ?? []).length >= 14 && played.length >= 10, { what: 'and the 2027 games come back with their results', expected: '≥14 games, ≥10 with results', actual: sf.ok ? `${(sf.data?.events ?? []).length} games, ${played.length} with results` : sf.error, role: 'parent', where: 'season_fixtures' })
    // A team's history through the lineage.
    const t5 = await val(pool, `select e.team_id from public.competition_entries e join public.teams t on t.id = e.team_id where e.competition_id = $1 and e.division = 'U11 Division 1' and t.rolled_from is not null limit 1`, [ctx.comp5])
    const t5sq = await squad(pool, t5)
    const th = await rpc(pool, t5sq.coach, 'team_history', { p_team: t5 })
    const s4 = (th.data?.seasons ?? []).find((s) => s.competition_id === comp4)
    check(th.ok && s4 && s4.position >= 1 && s4.won != null && s4.played >= 12, { what: 'the team\'s history shows its 2027 season: position, W-D-L and the ladder link', expected: 'a 2027 row with a position and W-D-L', actual: th.ok ? JSON.stringify(s4 ?? th.data?.seasons?.slice(0, 1)).slice(0, 200) : th.error, role: 'coach', where: 'team_history' })
    check((th.data?.lineage ?? []).length >= 2, { what: 'the lineage links the 2027 squad to the 2028 one', expected: '≥2 teams', actual: (th.data?.lineage ?? []).length, role: 'coach', where: 'team_lineage' })
    const strangerTh = await rpc(pool, ids.parent(30, 50), 'team_history', { p_team: t5 })
    check(!strangerTh.ok || strangerTh.data == null, { what: 'another club\'s parent gets nothing of it', expected: 'null', actual: strangerTh.ok ? (strangerTh.data == null ? 'null' : 'data') : 'refused', role: 'parent (another club)', where: 'team_history' })
  })

  add('2028-02-06 18:30', 'HH1 head to head across the seasons', async () => {
    scenario('HH1', 'Past seasons', 'Head to head on every match: this season\'s meetings, then every previous season\'s, hidden scores kept hidden')
    if (!ctx.comp5) return
    const g = (await gamesOn(pool, '2028-02-05', { division: 'U12 Division 1' })).find((x) => x.status === 'final') ?? (await gamesOn(pool, '2028-02-05')).find((x) => x.status === 'final' && x.home_team && x.away_team)
    if (!g) { check(false, { what: 'a played Season 5 game', expected: 'one', actual: 'none', role: '—', where: 'fixtures', quiet: true }); return }
    const parent = await guardianOf(pool, (await squad(pool, g.home_team)).players[0])
    const h = await rpc(pool, parent, 'head_to_head', { p_fixture: g.id })
    const prev = h.data?.previous ?? []
    check(h.ok && prev.length >= 1 && prev.every((m) => m.season === '2027'), { what: 'a Season 5 game\'s head to head lists the Season 4 meetings of the same two teams (by lineage)', expected: '≥1 meeting from 2027 (two legs when both played)', actual: h.ok ? `${prev.length} previous (${prev.map((m) => `${m.season} ${m.round} ${m.home_score}–${m.away_score}`).join('; ')})` : h.error, role: 'parent', where: 'head_to_head' })
    check(h.ok && h.data.summary.played === prev.length + (h.data.this_season ?? []).filter((m) => m.status === 'final').length, { what: 'the summary counts every played meeting', expected: 'played = meetings', actual: JSON.stringify(h.data?.summary), role: 'parent', where: 'head_to_head' })
    const pub = await asAnon(pool, async (c) => (await c.query(`select public.public_head_to_head('spl-season-5', $1) j`, [g.id])).rows[0].j)
    check(pub.ok && pub.data && (pub.data.previous ?? []).length === prev.length, { what: 'the public match centre shows the same head to head', expected: `${prev.length} previous`, actual: pub.ok ? `${(pub.data?.previous ?? []).length}` : pub.error, role: 'stranger', where: 'public_head_to_head' })
    const names = JSON.stringify(pub.data ?? {})
    const anyPlayer = await val(pool, `select count(*)::int from public.players pl where pl.academy_id in ($1, $2) and position(pl.full_name in $3) > 0`, [g.home_club, g.away_club, names])
    check(anyPlayer === 0, { what: 'no player\'s name is in it', expected: 0, actual: anyPlayer, role: 'stranger', where: 'public_head_to_head' })
    // MiniRoos: played, no score.
    const u9 = (await gamesOn(pool, '2028-02-05')).find((x) => x.division.startsWith('U10') && x.status === 'final' && x.home_team)
    if (u9) {
      const h9 = await rpc(pool, await guardianOf(pool, (await squad(pool, u9.home_team)).players[0]), 'head_to_head', { p_fixture: u9.id })
      const all9 = [...(h9.data?.previous ?? []), ...(h9.data?.this_season ?? [])]
      check(h9.ok && all9.length >= 1 && all9.every((m) => m.scores_hidden && m.home_score == null), { what: 'a MiniRoos head to head shows the meetings without scores', expected: 'played, no scores', actual: h9.ok ? `${all9.length} meetings, scores ${all9.some((m) => m.home_score != null) ? 'shown' : 'hidden'}` : h9.error, role: 'parent', where: 'head_to_head (scores_public)' })
    }
    ctx.h2hGame = g
  })

  add('2028-02-06 19:30', 'SCREENS Season 5: the switcher, a past season, head to head', async () => {
    if (!ctx.comp5) return
    await runScreens(ctx, 'season5', {
      extraPages: (p) => ({
        centre5: `/c/${SEASON5.slug}`,
        centre4: '/c/spl-season-4',
        publicGame: ctx.h2hGame ? `/c/${SEASON5.slug}/game/${ctx.h2hGame.id}` : null,
        competition4: `/competitions/${comp4}?tab=ladder`,
      }),
    })
  })
}
