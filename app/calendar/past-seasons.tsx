'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gameDayShort, kickOff } from '@/lib/time'

type Season = { season: string; teams: number; current: boolean }
type PastEvent = {
  id: string; team_id: string; team: string; type: string; title: string; starts_at: string; venue: string | null; opponent: string | null
  round: string | null; cancelled_at: string | null; cancellation_reason: string | null; competition_id: string | null; fixture_id: string | null
  ours: number | null; theirs: number | null; scores_hidden: boolean; status: string | null
}
type History = {
  seasons: {
    competition_id: string; competition: string; season: string | null; status: string; public_slug: string | null; team: string; division: string
    position: number | null; teams: number | null; played: number | null; won: number | null; drawn: number | null; lost: number | null
    goals_for: number | null; goals_against: number | null; points: number | null; finals: string | null; withdrawn: boolean
  }[]
}

/**
 * 0279: a family's past seasons on Fixtures. "This season" is the live
 * list; a past season is the squads' games as they finished — results,
 * called-off games, the lot — and each squad's "Previous seasons": where it
 * finished, W-D-L, how the finals went, with the ladder a tap away. Nothing
 * from a finished season is ever hidden.
 */
export function PastSeasons({ academyId, onSeason }: { academyId: string; onSeason: (season: string | null) => void }) {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [data, setData] = useState<{ teams: { id: string; name: string }[]; events: PastEvent[] } | null>(null)
  const [history, setHistory] = useState<Record<string, History | null>>({})
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('my_seasons', { p_academy: academyId })
      if (live) setSeasons((data as unknown as Season[] | null) ?? [])
    })()
    return () => { live = false }
  }, [academyId])

  useEffect(() => {
    onSeason(picked)
    if (!picked) { setData(null); return }
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('season_fixtures', { p_academy: academyId, p_season: picked })
      if (live) setData((data as unknown as { teams: { id: string; name: string }[]; events: PastEvent[] } | null) ?? { teams: [], events: [] })
    })()
    return () => { live = false }
  }, [picked, academyId, onSeason])

  async function toggleHistory(teamId: string) {
    if (open === teamId) return setOpen(null)
    setOpen(teamId)
    if (!(teamId in history)) {
      const { data } = await createClient().rpc('team_history', { p_team: teamId })
      setHistory((h) => ({ ...h, [teamId]: (data as unknown as History | null) ?? null }))
    }
  }

  const past = seasons.filter((s) => !s.current)
  if (past.length === 0) return null

  return (
    <section className="px-3.5 pt-3" data-past-seasons={past.length}>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button onClick={() => setPicked(null)} className="flex-none rounded-full px-3 py-1.5 text-xs font-semibold" style={!picked ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-season-chip="current">This season</button>
        {past.map((s) => (
          <button key={s.season} onClick={() => setPicked(s.season)} className="flex-none rounded-full px-3 py-1.5 text-xs font-semibold" style={picked === s.season ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-season-chip={s.season}>{s.season}</button>
        ))}
      </div>

      {picked && data && (
        <div className="mt-2" data-past-season={picked}>
          <p className="eyebrow px-1 pb-1.5">Previous seasons</p>
          <ul className="card overflow-hidden">
            {data.teams.map((t) => {
              const h = history[t.id]
              return (
                <li key={t.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--line-2)' }}>
                  <button onClick={() => toggleHistory(t.id)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm" aria-expanded={open === t.id} data-team-history={t.id}>
                    <span className="min-w-0 flex-1 font-medium">{t.name}</span>
                    <span className="text-xs text-ink-3">{open === t.id ? 'Hide' : 'History'}</span>
                  </button>
                  {open === t.id && (
                    <div className="px-3.5 pb-3 text-sm">
                      {!h ? <p className="text-xs text-ink-3">{t.id in history ? 'Nothing recorded yet.' : 'Loading…'}</p> : h.seasons.length === 0 ? <p className="text-xs text-ink-3">No competition seasons recorded.</p> : (
                        <ul className="divide-y" style={{ borderColor: 'var(--line-2)' }}>
                          {h.seasons.map((s) => (
                            <li key={`${s.competition_id}-${s.team}`} className="flex items-center gap-2 py-2" data-history-season={s.season ?? ''}>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{s.competition} <span className="text-ink-3">· {s.division}</span></span>
                                <span className="block text-xs text-ink-3">
                                  {s.position != null ? `${ordinal(s.position)} of ${s.teams}` : 'no ladder'}
                                  {s.won != null ? ` · ${s.won}-${s.drawn}-${s.lost}` : s.played != null ? ` · ${s.played} played` : ''}
                                  {s.goals_for != null ? ` · ${s.goals_for}:${s.goals_against}` : ''}
                                  {s.points != null ? ` · ${s.points} pts` : ''}
                                  {s.finals ? ` · ${s.finals}` : ''}{s.withdrawn ? ' · withdrew' : ''}
                                </span>
                              </span>
                              {s.public_slug && <a href={`/c/${s.public_slug}`} className="tap flex-none text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>Ladder</a>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <p className="eyebrow mt-3 px-1 pb-1.5">Games in {picked}</p>
          <ul className="card overflow-hidden">
            {data.events.length === 0 && <li className="px-3.5 py-3 text-sm text-ink-3">No games recorded for {picked}.</li>}
            {data.events.map((e) => (
              <li key={e.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--line-2)' }}>
                <a href={`/calendar/${e.id}`} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm" data-past-game={e.id}>
                  <span className="w-[4.5rem] flex-none text-xs leading-tight text-ink-3">{gameDayShort(e.starts_at)}<span className="block">{kickOff(e.starts_at)}</span></span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.team}{e.opponent ? <> <span className="text-ink-3">v</span> {e.opponent}</> : null}
                    <span className="block truncate text-xs text-ink-3">{[e.round, e.venue].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex-none text-sm font-semibold tabular-nums">
                    {e.cancelled_at ? <span className="text-xs font-normal" style={{ color: 'var(--no)' }}>{e.cancellation_reason === 'forfeit' ? 'forfeit' : 'called off'}</span>
                      : e.scores_hidden ? <span className="text-xs font-normal text-ink-3">played</span>
                      : e.ours != null ? `${e.ours}–${e.theirs}` : <span className="text-xs font-normal text-ink-3">—</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 4 ? 0 : n % 10 > 3 ? 0 : n % 10]}`
