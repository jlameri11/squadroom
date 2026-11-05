'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useWaitingTaps, withWaiting } from './waiting-taps'

/**
 * Everything the top of a game page needs, read once (Joey, 4 Nov 2026:
 * the game page, benchmarked on a match preview).
 *
 *   live      the score as it happens (event_live, X-01), refreshed every
 *             fifteen seconds while the game is on — plus any score taps
 *             still on this phone with no signal (X-09), so the hero and
 *             the timeline never disagree; a refresh that fails keeps the
 *             score it had;
 *   result    the final score (event_result);
 *   sides     who is on the left and the right — home on the left, as a
 *             programme prints it — with each side's crest where it is known
 *             (fixture_sides, 0210; initials until then);
 *   form      the last five for both sides: ours from every match the squad
 *             played (team_form), theirs from the competition's results;
 *   ladder    the division's table (competition_ladder), only for a game in
 *             a competition.
 *
 * Each read is the person's own, through RLS: a parent of an entered club
 * sees the draw and the table, never another club's people.
 */
export type GameEvent = {
  id: string
  academy_id: string
  team_id: string | null
  type: string
  starts_at: string
  opponent: string | null
  fixture_id: string | null
  competition_id: string | null
  cancelled_at: string | null
}
export type Side = { name: string; sub: string | null; logo: string | null }
export type Outcome = 'won' | 'drew' | 'lost'
export type FormRow = { outcome: Outcome; ours: number; theirs: number; against: string | null; at: string }
export type LadderRow = { pos: number; entry_id: string; team_name: string; played: number; won: number; drawn: number; lost: number; gd: number; points: number }
export type Live = { kicked_off: boolean; finished: boolean; over: boolean; window_open: boolean; score: { ours: number; theirs: number } }
export type Game = {
  live: Live | null
  final: { ours: number; theirs: number } | null
  usOnLeft: boolean
  left: Side
  right: Side
  ourForm: FormRow[] | null
  theirForm: FormRow[] | null
  ladder: LadderRow[] | null
  ourEntry: string | null
  theirEntry: string | null
  division: string | null
  competition: string | null
}

const initials = (name: string) =>
  name
    .replace(/\b(FC|SC|AFC|JFC|Junior|Juniors|Football|Club|Soccer)\b/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || name.slice(0, 2).toUpperCase()

export { initials }

export function useGame(event: GameEvent, us: { club: string; team: string | null; logo: string | null }): Game | undefined {
  const [game, setGame] = useState<Game | undefined>(undefined)
  const current = useRef<Game | undefined>(undefined)
  useEffect(() => {
    current.current = game
  }, [game])

  const load = useCallback(async () => {
    const supabase = createClient()
    const isGame = event.type === 'match' || event.type === 'tournament'
    const [{ data: live }, { data: result }, { data: form }] = await Promise.all([
      isGame ? supabase.rpc('event_live', { p_event: event.id }) : Promise.resolve({ data: null }),
      supabase.rpc('event_result', { p_event: event.id }),
      event.team_id && isGame ? supabase.rpc('team_form', { p_team: event.team_id, p_n: 5 }) : Promise.resolve({ data: null }),
    ])

    const ourSide: Side = { name: us.club, sub: us.team, logo: us.logo }
    let theirSide: Side = { name: event.opponent ?? 'Opposition', sub: null, logo: null }
    let usOnLeft = true
    let ladder: LadderRow[] | null = null
    let theirForm: FormRow[] | null = null
    let ourEntry: string | null = null
    let theirEntry: string | null = null
    let division: string | null = null
    let competition: string | null = null
    let competitionForm: FormRow[] | null = null

    if (event.fixture_id) {
      const { data: f } = await supabase
        .from('fixtures')
        .select('competition_id, division, home_entry_id, away_entry_id')
        .eq('id', event.fixture_id)
        .maybeSingle()
      if (f) {
        division = f.division
        const ids = [f.home_entry_id, f.away_entry_id].filter((x): x is string => Boolean(x))
        const [{ data: allEntries }, sides, { data: table }, { data: comp }] = await Promise.all([
          // The competition's entries: the two sides, and the names of
          // everybody they have played, for the form's titles.
          supabase.from('competition_entries').select('id, display_name, team_id, academy_id').eq('competition_id', f.competition_id),
          // 0210; until it exists this errors and the crests are initials.
          supabase.rpc('fixture_sides', { p_fixture: event.fixture_id }),
          supabase.rpc('competition_ladder', { p_competition: f.competition_id, p_division: f.division }),
          supabase.from('competitions').select('name').eq('id', f.competition_id).maybeSingle(),
        ])
        competition = comp?.name ?? null
        const entries = (allEntries ?? []).filter((e) => ids.includes(e.id))
        const mine = (entries ?? []).find((e) => (event.team_id && e.team_id === event.team_id)) ?? (entries ?? []).find((e) => e.academy_id === event.academy_id)
        const other = (entries ?? []).find((e) => e.id !== mine?.id) ?? null
        ourEntry = mine?.id ?? null
        theirEntry = other?.id ?? null
        usOnLeft = !mine || mine.id === f.home_entry_id
        const crest = (sides.data as { home?: { entry_id: string; logo: string | null; club: string | null } | null; away?: { entry_id: string; logo: string | null; club: string | null } | null } | null) ?? null
        const crestOf = (id: string | null) => [crest?.home, crest?.away].find((x) => x && x.entry_id === id) ?? null
        if (mine) ourSide.sub = mine.display_name
        if (other) {
          const c = crestOf(other.id)
          theirSide = { name: c?.club ?? other.display_name, sub: c?.club ? other.display_name : null, logo: c?.logo ?? null }
        }
        if (table) {
          ladder = (table as { entry_id: string; team_name: string; played: number; won: number; drawn: number; lost: number; goal_difference: number; points: number }[]).map((r, i) => ({
            pos: i + 1, entry_id: r.entry_id, team_name: r.team_name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gd: r.goal_difference, points: r.points,
          }))
        }
        // In a competition, both sides' last five come from its results — a
        // league game's score lives on the fixture, not on the club's event.
        const names = new Map((allEntries ?? []).map((e) => [e.id, e.display_name]))
        const formFor = async (entry: string): Promise<FormRow[]> => {
          const { data: rows } = await supabase
            .from('fixtures')
            .select('starts_at, home_entry_id, away_entry_id, home_score, away_score')
            .eq('competition_id', f.competition_id)
            .or(`home_entry_id.eq.${entry},away_entry_id.eq.${entry}`)
            .not('home_score', 'is', null)
            .not('away_score', 'is', null)
            .order('starts_at', { ascending: false })
            .limit(5)
          return (rows ?? []).map((x) => {
            const home = x.home_entry_id === entry
            const a = (home ? x.home_score : x.away_score) ?? 0
            const b = (home ? x.away_score : x.home_score) ?? 0
            const opp = home ? x.away_entry_id : x.home_entry_id
            return { outcome: a > b ? 'won' : a < b ? 'lost' : 'drew', ours: a, theirs: b, against: (opp && names.get(opp)) ?? null, at: x.starts_at ?? '' }
          })
        }
        const [ourComp, theirComp] = await Promise.all([mine ? formFor(mine.id) : Promise.resolve(null), other ? formFor(other.id) : Promise.resolve(null)])
        competitionForm = ourComp
        theirForm = theirComp
      }
    } else {
      const r = (result as { was_home: boolean }[] | null)?.[0]
      if (r && r.was_home === false) usOnLeft = false
    }

    const ourForm = competitionForm ?? (form
      ? ((form as { last: { outcome: Outcome; ours: number; theirs: number; opponent: string | null; starts_at: string }[] }).last ?? []).map((x) => ({ outcome: x.outcome, ours: x.ours, theirs: x.theirs, against: x.opponent, at: x.starts_at }))
      : null)
    const r0 = (result as { ours: number; theirs: number }[] | null)?.[0]
    const l = live as Live | null
    const final = r0 ? { ours: r0.ours, theirs: r0.theirs } : l?.finished ? l.score : null

    setGame({
      live: l,
      final,
      usOnLeft,
      left: usOnLeft ? ourSide : theirSide,
      right: usOnLeft ? theirSide : ourSide,
      ourForm,
      theirForm,
      ladder,
      ourEntry,
      theirEntry,
      division,
      competition,
    })
  }, [event.id, event.type, event.team_id, event.fixture_id, event.opponent, event.academy_id, us.club, us.team, us.logo])

  // The score alone, while the game is on — the table, the form and the
  // crests do not change in the middle of it.
  const refreshScore = useCallback(async () => {
    // Nothing to ask with no signal — and an answer that does not come leaves
    // the score as it was. Until 5 Nov one failed refresh blanked the live
    // score, which also stopped this refreshing for the rest of the game.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const supabase = createClient()
    const [{ data: live, error: liveError }, { data: result, error: resultError }] = await Promise.all([
      supabase.rpc('event_live', { p_event: event.id }),
      supabase.rpc('event_result', { p_event: event.id }),
    ])
    if (liveError || resultError) return
    const l = live as Live | null
    const r0 = (result as { ours: number; theirs: number }[] | null)?.[0]
    setGame((g) => (g ? { ...g, live: l, final: r0 ? { ours: r0.ours, theirs: r0.theirs } : l?.finished ? l.score : null } : g))
  }, [event.id])

  useEffect(() => {
    let live = true
    ;(async () => {
      if (live) await load()
    })()
    const timer = setInterval(() => {
      const g = current.current
      const on = g?.live && g.live.window_open && !g.live.finished
      if (on && document.visibilityState === 'visible') void refreshScore()
    }, 15_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [load, refreshScore])

  // Score taps still on this phone (X-09): the hero counts them too.
  const { taps } = useWaitingTaps(event.id, refreshScore)
  return useMemo(() => {
    if (!game?.live || taps.length === 0) return game
    const live = withWaiting(game.live, taps)
    return { ...game, live, final: game.final ?? (live.finished ? live.score : null) }
  }, [game, taps])
}
