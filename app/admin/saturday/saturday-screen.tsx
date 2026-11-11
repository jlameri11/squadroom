'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { DEFAULT_TZ } from '@/lib/time'

type Game = {
  event_id: string
  starts_at: string
  team_id: string
  team: string
  age_group: string
  opponent: string | null
  was_home: boolean | null
  venue: string | null
  venue_id: string | null
  off: boolean
  reason: string | null
  kicked_off: boolean
  finished: boolean
  in_competition: boolean
  scores_shown: boolean
  ours: number | null
  theirs: number | null
  manager: string | null
  coaches: string | null
  yes: number
  squad: number
  min_players: number
  referee: 'appointed' | 'none' | null
  sheet: boolean | null
}
type View = {
  date: string
  next_with_games: string | null
  games: Game[]
  counts: { games: number; off: number; live: number; final: number; nobody_in_charge: number; short: number; no_referee: number; sheets_missing: number }
}

/**
 * The club's Saturday (Big Club Mode item 9; 0251): every game today across
 * the club, by ground. Each row says what the President would otherwise
 * ring around for: called off and why, kicked off, finished and the score
 * where a score is kept (MiniRoos keep none), who is in charge, how many
 * have said yes against the number the format needs, and for the club's
 * own competitions whether a referee is appointed and the sheet is in.
 * Owners, admins, the President, the Secretary and coordinators; the
 * database decides.
 */
export function SaturdayScreen() {
  const org = useCurrentOrg()
  const [date, setDate] = useState<string | null>(null)
  const [view, setView] = useState<View | null | undefined>(undefined)
  const [jumped, setJumped] = useState(false)

  const load = useCallback(async (orgId: string, d: string | null) => {
    const { data } = await createClient().rpc('saturday_view', { p_academy: orgId, p_date: (d ?? null) as unknown as string })
    setView((data as unknown as View | null) ?? null)
  }, [])

  useEffect(() => {
    if (!org) return
    void load(org.id, date)
  }, [org, date, load])

  // An empty today jumps once to the next day with games, so the screen
  // opens on Saturday when it is looked at on a Thursday.
  useEffect(() => {
    if (!view || jumped || date !== null) return
    if (view.games.length === 0 && view.next_with_games) {
      setJumped(true)
      setDate(view.next_with_games)
    }
  }, [view, jumped, date])

  if (!org || view === undefined) return <ScreenSkeleton />
  if (view === null) {
    return <p className="m-5 card p-5 text-center text-sm text-ink-2">Game day is for the people who run the club and its squads.</p>
  }

  const tz = org.timezone || DEFAULT_TZ
  const day = new Date(`${view.date}T12:00:00`)
  const title = day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
  const shift = (n: number) => {
    const d = new Date(`${view.date}T12:00:00`)
    d.setDate(d.getDate() + n)
    setDate(d.toISOString().slice(0, 10))
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  const grounds = [...new Set(view.games.map((g) => g.venue ?? 'Ground to be confirmed'))]
  const c = view.counts

  return (
    <div className="p-4 pb-10" data-saturday={view.games.length}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => shift(-1)} className="tap rounded-lg px-2 py-1 text-sm" aria-label="The day before">‹</button>
        <h2 className="display min-w-0 flex-1 truncate text-center text-[1.25rem] leading-tight" data-saturday-date={view.date}>{title}</h2>
        <button onClick={() => shift(1)} className="tap rounded-lg px-2 py-1 text-sm" aria-label="The day after">›</button>
      </div>

      {view.games.length === 0 ? (
        <p className="card mt-4 p-5 text-center text-sm text-ink-2">
          No games that day.
          {view.next_with_games && (
            <>
              {' '}
              <button onClick={() => setDate(view.next_with_games)} className="tap font-semibold underline underline-offset-4" data-saturday-next>
                Next games {new Date(`${view.next_with_games}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          {/* The numbers first: what needs a phone call. */}
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs" data-saturday-counts>
            <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}>{c.games} {c.games === 1 ? 'game' : 'games'}</span>
            {c.live > 0 && <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{c.live} live</span>}
            {c.final > 0 && <span className="pill" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }}>{c.final} finished</span>}
            {c.off > 0 && <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{c.off} called off</span>}
            {c.nobody_in_charge > 0 && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{c.nobody_in_charge} nobody in charge</span>}
            {c.short > 0 && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{c.short} short of players</span>}
            {c.no_referee > 0 && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{c.no_referee} without a referee</span>}
            {c.sheets_missing > 0 && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{c.sheets_missing} {c.sheets_missing === 1 ? 'sheet' : 'sheets'} missing</span>}
          </div>

          {grounds.map((ground) => (
            <section key={ground} className="card mt-3 p-3.5" data-saturday-ground={ground}>
              <div className="sect">
                <span className="eyebrow truncate">{ground}</span>
                <span className="text-xs text-ink-3">{view.games.filter((g) => (g.venue ?? 'Ground to be confirmed') === ground).length}</span>
              </div>
              <ul className="mt-1 flex flex-col divide-y divide-[var(--line-2)]">
                {view.games.filter((g) => (g.venue ?? 'Ground to be confirmed') === ground).map((g) => {
                  const short = !g.off && !g.finished && g.yes < g.min_players
                  const nobody = !g.manager && !g.coaches
                  return (
                    <li key={g.event_id}>
                      <Link href={`/calendar/${g.event_id}`} className="block py-2.5" data-saturday-game={g.event_id}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate">
                            <b className="tabular-nums">{time(g.starts_at)}</b> {g.team}
                            {g.opponent ? <span className="text-ink-2"> v {g.opponent}</span> : ''}
                          </span>
                          <span className="flex-none text-sm">
                            {g.off ? (
                              <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Called off</span>
                            ) : g.finished ? (
                              g.scores_shown && g.ours != null ? (
                                <span className="tabular-nums font-semibold" data-saturday-score>{g.ours}–{g.theirs}</span>
                              ) : (
                                <span className="text-xs text-ink-3">played</span>
                              )
                            ) : g.kicked_off ? (
                              <span className="pill" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Live{g.scores_shown && g.ours != null ? ` ${g.ours}–${g.theirs}` : ''}</span>
                            ) : (
                              <span className="text-xs text-ink-3">{g.was_home === false ? 'away' : g.was_home ? 'home' : ''}</span>
                            )}
                          </span>
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-ink-2">
                          {g.off && g.reason && <span>{g.reason.replace(/_/g, ' ')}</span>}
                          <span>{g.manager ? `manager ${g.manager}` : g.coaches ? `coach ${g.coaches}` : ''}</span>
                          {nobody && !g.off && <span style={{ color: 'var(--accent)' }}>nobody in charge</span>}
                          {!g.off && !g.finished && (
                            <span style={short ? { color: 'var(--accent)' } : undefined}>
                              {g.yes} of {g.min_players} needed said yes{g.squad ? ` · squad ${g.squad}` : ''}
                            </span>
                          )}
                          {g.referee === 'none' && !g.off && <span style={{ color: 'var(--accent)' }}>no referee</span>}
                          {g.sheet === false && !g.off && <span style={{ color: 'var(--accent)' }}>sheet not in</span>}
                          {!g.scores_shown && <span className="text-ink-3">MiniRoos · no score</span>}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
