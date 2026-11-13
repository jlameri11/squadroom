'use client'

import Link from 'next/link'
import { useScreen } from '@/lib/hooks/use-screen'
import { isMiniRoos } from '@/lib/age-group'
import { EventDetail } from './event-detail'
import { GameSkeleton } from './game-skeleton'

type EventRow = Parameters<typeof EventDetail>[0]['event']

/** What `game_screen` (0273) answers: the page's props in one call. */
export type GameScreen = {
  denied?: boolean
  missing?: boolean
  event?: EventRow
  mine?: { player_id: string | null; player_name: string | null; status: string | null; note: string | null }[]
  summary?: { going: number; maybe: number; out_count: number; no_reply: number } | null
  roster?: { player_id: string | null; name: string; status: string | null; note: string | null }[]
  club?: { name: string; logo_url: string | null; timezone: string | null; miniroos_scores: boolean | null } | null
  team?: { name: string; age_group: string } | null
  is_coach?: boolean
}

/**
 * A game, loaded from the browser (the "Feels instant" pass; 0273).
 *
 * The server used to render this page in us-east-2 — the event, then five
 * reads in parallel, two trips to Sydney before the hero. Now the page is a
 * shell and this asks for the screen in one call, cached like Home: the next
 * game opened from Home paints at once the second time, and its own skeleton
 * the first.
 */
export function GameLoader({ eventId }: { eventId: string }) {
  const { data, failed } = useScreen<GameScreen>('game_screen', { p_event: eventId })

  if (!data) {
    if (failed) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-ink-2">Couldn&apos;t load this game. Check your signal and try again.</p>
          <Link href="/calendar" className="text-sm font-semibold underline underline-offset-4">← Fixtures</Link>
        </main>
      )
    }
    return <GameSkeleton />
  }
  if (data.denied || data.missing || !data.event) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">{data.missing ? 'No such game' : 'Not one of your games'}</h1>
        <p className="text-sm text-ink-2">{data.missing ? 'It may have been removed.' : 'Only its squad and the club can open it.'}</p>
        <Link href="/calendar" className="text-sm font-semibold underline underline-offset-4">← Fixtures</Link>
      </main>
    )
  }
  const event = data.event
  const team = data.team ?? null
  const club = data.club ?? null
  return (
    <main className="mx-auto max-w-md p-5">
      <Link href="/calendar" className="text-sm text-ink-2">← Fixtures</Link>
      <EventDetail
        event={event}
        mine={(data.mine ?? []).map((r) => ({ playerId: r.player_id, playerName: r.player_name, status: r.status, note: r.note }))}
        isCoach={data.is_coach === true}
        // 0251: a competition game keeps its score; a club game in MiniRoos (U5–U11) keeps none unless the club says so.
        scoresShown={Boolean(event.fixture_id) || !team || !isMiniRoos(team.age_group) || Boolean(club?.miniroos_scores)}
        tz={club?.timezone || 'Australia/Sydney'}
        us={{ club: club?.name ?? 'Us', team: team?.name ?? null, logo: club?.logo_url ?? null }}
        summary={data.summary ?? null}
        roster={(data.roster ?? []).map((r) => ({ playerId: r.player_id, name: r.name, status: r.status, note: r.note }))}
      />
    </main>
  )
}
