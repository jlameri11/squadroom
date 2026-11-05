'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_TZ } from '@/lib/time'

type Scorer = { name: string; goals: number }
type Game = { id: string; title: string; starts_at: string; opponent: string | null; venue: string | null; team_id: string; team: string | null; ours: number | null; theirs: number | null; scorers: Scorer[]; videos: number }

const TINT = { won: 'var(--yes)', drew: 'var(--maybe)', lost: 'var(--no)' } as const
const INK = { won: 'var(--yes-ink)', drew: 'var(--maybe-ink)', lost: 'var(--no-ink)' } as const

/**
 * Matchdays: the games already played — the score, who scored, and whether
 * the video is up. A family's own squads; the club's staff see every squad.
 * No Player of the Match here: that is the game's own page.
 */
export function Matchdays({ academyId }: { academyId: string }) {
  const [games, setGames] = useState<Game[] | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('my_matchdays', { p_academy: academyId, p_limit: 60 })
      if (live) setGames(error ? [] : ((data as unknown as Game[]) ?? []))
    })()
    return () => {
      live = false
    }
  }, [academyId])

  if (!games) return <p className="p-6 text-center text-sm text-ink-3">Loading…</p>
  if (games.length === 0) return <p className="p-6 text-center text-sm text-ink-3">No games played yet. They land here after the whistle, with the score, the scorers and the video.</p>

  const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { timeZone: DEFAULT_TZ, weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <ul data-matchdays>
      {games.map((g, i) => {
        const outcome = g.ours == null || g.theirs == null ? null : g.ours > g.theirs ? 'won' : g.ours < g.theirs ? 'lost' : 'drew'
        const heading = day(g.starts_at)
        const showHeading = i === 0 || day(games[i - 1].starts_at) !== heading
        return (
          <li key={g.id}>
            {showHeading && (
              <p className="eyebrow px-4 pb-1 pt-3" style={{ background: 'var(--paper)' }}>{heading}</p>
            )}
            <Link href={`/calendar/${g.id}`} className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: 'var(--line-2)', background: 'var(--surface)' }} data-matchday={g.id}>
              <span className="grid h-12 w-14 flex-none place-items-center rounded-lg" style={{ background: outcome ? TINT[outcome] : 'var(--surface-2)', color: outcome ? INK[outcome] : 'var(--ink-3)' }} data-score>
                <span className="display text-lg tabular-nums">{g.ours == null || g.theirs == null ? '–' : `${g.ours}–${g.theirs}`}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{g.team ?? ''}{g.opponent ? ` v ${g.opponent}` : ''}</span>
                <span className="block truncate text-xs text-ink-2">
                  {g.scorers.length > 0 ? g.scorers.map((s) => `${s.name.split(' ')[0]}${s.goals > 1 ? ` ×${s.goals}` : ''}`).join(', ') : outcome ? 'No scorers recorded' : 'Score to come'}
                </span>
              </span>
              <span className="flex-none text-right text-xs text-ink-3">
                {g.videos > 0 ? <span className="pill" style={{ background: 'var(--brand-soft)', color: 'var(--brand-text)' }} data-has-video>🎬 video</span> : '›'}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
