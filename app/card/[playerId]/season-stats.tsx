'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_TZ } from '@/lib/time'

type Game = { event_id: string; starts_at: string; opponent: string | null; title: string; goals: number; assists: number; minutes: number | null; potm: boolean; ours: number | null; theirs: number | null }
type Season = { appearances: number; goals: number; assists: number; minutes: number; potm: number; games: Game[] }

/** X-02: the child's season on their card — games, goals, assists, stars. */
export function SeasonStats({ playerId }: { playerId: string }) {
  const [s, setS] = useState<Season | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('player_season_stats', { p_player: playerId })
      if (live) setS(error ? null : (data as unknown as Season))
    })()
    return () => {
      live = false
    }
  }, [playerId])

  if (!s || s.appearances === 0) return null
  return (
    <section className="mt-5" data-season-stats>
      <div className="sect">
        <div>
          <span className="eyebrow">This season</span>
          <p className="text-sm">
            <b>{s.appearances}</b> {s.appearances === 1 ? 'game' : 'games'} · <b>{s.goals}</b> {s.goals === 1 ? 'goal' : 'goals'} · <b>{s.assists}</b> {s.assists === 1 ? 'assist' : 'assists'}
            {s.potm > 0 && <> · <b>{s.potm}×</b> 🏆</>}
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="text-xs" style={{ color: 'var(--brand-text)' }}>{open ? 'Hide' : 'Games'}</button>
      </div>
      {open && (
        <ul className="card divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {s.games.map((g) => (
            <li key={g.event_id} className="flex items-center gap-2 px-3 py-2">
              <Link href={`/calendar/${g.event_id}`} className="min-w-0 flex-1 truncate">
                {new Date(g.starts_at).toLocaleDateString('en-AU', { timeZone: DEFAULT_TZ, day: 'numeric', month: 'short' })} · {g.opponent ? `v ${g.opponent}` : g.title}
                {g.ours != null && g.theirs != null && <span className="text-ink-3"> {g.ours}–{g.theirs}</span>}
              </Link>
              <span className="flex-none text-xs tabular-nums text-ink-2">
                {g.goals > 0 && `⚽${g.goals} `}{g.assists > 0 && `🅰${g.assists} `}{g.potm && '🏆'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
