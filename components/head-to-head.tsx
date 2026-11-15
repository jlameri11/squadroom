'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { gameDayShort, kickOff } from '@/lib/time'

/**
 * Head to head (Joey, 15 Nov 2026): the two teams' meetings in THIS season
 * — the season the game belongs to — with a summary (played, each side's
 * wins, draws, goals) and the list, each a tap away. Past seasons stay
 * reachable through the season switcher and are never mixed in. A MiniRoos
 * game shows "played", not a score; no player's name is here. The same card
 * serves the app's game page, the competition's match page and the public
 * match centre (which loads the data on the server).
 */
export type Meeting = {
  fixture_id: string
  competition_id: string
  competition: string | null
  season: string | null
  public_slug: string | null
  round: string | null
  stage: string | null
  starts_at: string | null
  venue: string | null
  home: string | null
  away: string | null
  home_score: number | null
  away_score: number | null
  pens_home: number | null
  pens_away: number | null
  scores_hidden: boolean
  status: string
  home_is_first: boolean
  this_season: boolean
}
export type HeadToHeadData = {
  first: string | null
  second: string | null
  season: string | null
  competition: string | null
  summary: { played: number; first_wins: number; second_wins: number; draws: number; first_goals: number; second_goals: number; hidden: number }
  meetings: Meeting[]
  last5: Meeting[]
}

const short = (name: string | null) => (name ?? '?').replace(/\s+(U\d+|Open|Over-\d+).*$/, '').trim()

export function HeadToHeadCard({ data, href }: { data: HeadToHeadData; href?: (m: Meeting) => string | null }) {
  const s = data.summary
  const meetings = data.meetings ?? []
  const label = `Head to head${data.season ? ` · ${data.season}` : ' · this season'}`
  if (!s || (s.played === 0 && meetings.length === 0)) {
    return (
      <section className="mt-4" data-head-to-head="empty">
        <h3 className="eyebrow px-1 pb-1.5">{label}</h3>
        <div className="card px-3.5 py-3 text-sm text-ink-3">These two have not met yet this season.</div>
      </section>
    )
  }
  return (
    <section className="mt-4" data-head-to-head={s.played}>
      <h3 className="eyebrow px-1 pb-1.5">{label}</h3>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-3 items-center gap-2 px-3.5 py-3 text-center">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{s.first_wins}</p>
            <p className="truncate text-xs text-ink-3">{short(data.first)} wins</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{s.draws}</p>
            <p className="text-xs text-ink-3">draws</p>
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{s.second_wins}</p>
            <p className="truncate text-xs text-ink-3">{short(data.second)} wins</p>
          </div>
        </div>
        <p className="border-t px-3.5 py-2 text-center text-xs text-ink-3" style={{ borderColor: 'var(--line-2)' }}>
          {s.played} {s.played === 1 ? 'meeting' : 'meetings'} this season
          {s.played - s.hidden > 0 ? ` · goals ${s.first_goals}–${s.second_goals}` : ''}
          {s.hidden > 0 ? ` · ${s.hidden} without a score kept` : ''}
          {meetings.length > s.played ? ` · ${meetings.length - s.played} still to play` : ''}
        </p>
        {meetings.map((m) => {
          const link = href?.(m) ?? null
          const row = (
            <div className="flex items-center gap-2.5 border-t px-3.5 py-2.5 text-sm" style={{ borderColor: 'var(--line-2)' }} data-meeting={m.fixture_id}>
              <span className="w-[4.5rem] flex-none text-xs leading-tight text-ink-3">
                {m.starts_at ? gameDayShort(m.starts_at) : 'TBC'}
                <span className="block">{m.season ?? ''}{m.round ? ` · ${m.round.replace('Round ', 'R')}` : ''}</span>
              </span>
              <span className="min-w-0 flex-1 truncate">
                {short(m.home)} <span className="text-ink-3">v</span> {short(m.away)}
                <span className="block truncate text-xs text-ink-3">{m.venue ?? ''}{m.starts_at ? ` · ${kickOff(m.starts_at)}` : ''}</span>
              </span>
              <span className="flex-none text-sm font-semibold tabular-nums">
                {m.status === 'final' || m.status === 'forfeit'
                  ? m.scores_hidden ? <span className="text-xs font-normal text-ink-3">played</span>
                    : <>{m.home_score}–{m.away_score}{m.pens_home != null ? <span className="text-xs font-normal text-ink-3"> ({m.pens_home}–{m.pens_away} pens)</span> : null}</>
                  : <span className="text-xs font-normal text-ink-3">{m.status === 'scheduled' ? 'to play' : m.status}</span>}
              </span>
            </div>
          )
          return link ? <a key={m.fixture_id} href={link} className="block">{row}</a> : <div key={m.fixture_id}>{row}</div>
        })}
      </div>
    </section>
  )
}

/** The app's loader: a participant's own read of the fixture's head to head. */
export function HeadToHead({ fixtureId, competitionId }: { fixtureId: string; competitionId?: string | null }) {
  const [data, setData] = useState<HeadToHeadData | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('head_to_head', { p_fixture: fixtureId })
      if (!live) return
      setData(error ? null : ((data as unknown as HeadToHeadData | null) ?? null))
    })()
    return () => { live = false }
  }, [fixtureId])
  if (!data) return null
  return <HeadToHeadCard data={data} href={(m) => (competitionId ? `/competitions/${m.competition_id}/match/${m.fixture_id}` : m.public_slug ? `/c/${m.public_slug}/game/${m.fixture_id}` : null)} />
}
