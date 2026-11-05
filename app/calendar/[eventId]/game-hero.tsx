'use client'

import { countdown, gameDay, kickOff } from '@/lib/time'
import { initials, type Game, type Side } from './use-game'

/**
 * The top of a game (Joey, 4 Nov 2026; benchmark: a match preview).
 *
 * Both crests — the other side's when Squadroom knows it (0210), its
 * initials when not — both names, home on the left as a programme prints
 * it, and in the middle the one thing that matters at that moment: how far
 * off it is ("in 3 days"), then on the day the kick-off time, then the live
 * score, then the final one. On the club's colour (--bar): the club's own
 * when the person wears club colours, Squadroom's black when not.
 *
 * Every time is the venue's (lib/time.ts) — never the phone's, never the
 * server's.
 */
export function GameHero({
  startsAt,
  cancelled,
  label,
  venue,
  tz,
  game,
  fallbackLeft,
  fallbackRight,
}: {
  startsAt: string
  cancelled: boolean
  label: string
  venue: string | null
  tz: string
  game: Game | undefined
  fallbackLeft: Side
  fallbackRight: Side
}) {
  const left = game?.left ?? fallbackLeft
  const right = game?.right ?? fallbackRight
  const live = game?.live
  const isLive = Boolean(live?.kicked_off && !live.finished)
  const usOnLeft = game?.usOnLeft ?? true
  const shown = (s: { ours: number; theirs: number }) => (usOnLeft ? `${s.ours}–${s.theirs}` : `${s.theirs}–${s.ours}`)
  const away = countdown(startsAt, new Date(), tz)

  let state: 'off' | 'live' | 'final' | 'today' | 'ahead' = 'ahead'
  if (cancelled) state = 'off'
  else if (isLive) state = 'live'
  else if (game?.final) state = 'final'
  else if (away === 'today') state = 'today'

  return (
    <section
      className="mt-3 rounded-2xl px-3.5 pb-4 pt-3.5"
      style={{ background: 'var(--bar)', color: 'var(--bar-ink)', border: '1px solid var(--bar-line)' }}
      data-game-hero
      data-state={state}
    >
      <p className="eyebrow truncate text-center" style={{ color: 'inherit', opacity: 0.75 }}>{label}</p>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2">
        <Crest side={left} />

        <div className="flex min-w-[5.5rem] flex-col items-center justify-center self-center px-1 text-center" data-hero-centre suppressHydrationWarning>
          {state === 'off' && (
            <span className="rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={{ background: 'var(--no)', color: 'var(--no-ink)' }}>
              Called off
            </span>
          )}
          {state === 'live' && live && (
            <>
              <span className="display text-[2.25rem] leading-none tabular-nums" data-hero-score>{shown(live.score)}</span>
              <span className="mt-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide" style={{ background: 'var(--no)', color: 'var(--no-ink)' }}>Live</span>
            </>
          )}
          {state === 'final' && game?.final && (
            <>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ opacity: 0.75 }}>Full time</span>
              <span className="display mt-0.5 text-[2.25rem] leading-none tabular-nums" data-hero-score>{shown(game.final)}</span>
            </>
          )}
          {state === 'today' && (
            <>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ opacity: 0.75 }}>Today</span>
              <span className="display mt-0.5 text-[1.75rem] leading-none tabular-nums" data-kick-off>{kickOff(startsAt, tz)}</span>
            </>
          )}
          {state === 'ahead' && (
            <>
              <span className="display text-[1.5rem] leading-tight" data-countdown>{away[0].toUpperCase() + away.slice(1)}</span>
              <span className="mt-0.5 text-sm tabular-nums" style={{ opacity: 0.85 }} data-kick-off>{kickOff(startsAt, tz)}</span>
            </>
          )}
        </div>

        <Crest side={right} />
      </div>

      <p className="mt-3 text-center text-sm" style={{ opacity: 0.85 }} data-hero-when>
        {gameDay(startsAt, tz)} · {kickOff(startsAt, tz)}
        {venue ? ` · ${venue}` : ''}
      </p>
    </section>
  )
}

function Crest({ side }: { side: Side }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center" data-side>
      {side.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a club's own file, any format
        <img src={side.logo} alt="" className="aspect-square w-full max-w-14 rounded-xl bg-white object-contain p-1" data-crest="logo" />
      ) : (
        <span
          className="display grid aspect-square w-full max-w-14 place-items-center rounded-xl text-lg"
          style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }}
          data-crest="initials"
        >
          {initials(side.name)}
        </span>
      )}
      <span className="w-full text-sm font-semibold leading-tight [overflow-wrap:anywhere]">{side.name}</span>
      {side.sub && <span className="w-full text-xs leading-tight [overflow-wrap:anywhere]" style={{ opacity: 0.75 }}>{side.sub}</span>}
    </div>
  )
}
