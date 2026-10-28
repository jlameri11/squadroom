'use client'

import Link from 'next/link'
import { type HomeEvent } from './home'

/**
 * An evening of training, as one row.
 *
 * A club that trains three squads on a Thursday has three events, which is
 * right: each one has its own register, its own cancellation and its own
 * answers. But on a screen they were three identical cards, one after
 * another, carrying "29 THU · Training · 5:00pm · ELS Hall Park" three times
 * with only the squad name different.
 *
 * On a coach's home screen that filled three of the five slots, so the
 * Saturday match — the thing anybody actually opens the app for — started
 * below the fold.
 *
 * This is the same information in a third of the space. Nothing is hidden:
 * every squad is named, every time is there, and each one is still its own
 * link. What goes is the repetition of the date, the venue and the word
 * "training".
 *
 * MATCHES ARE NEVER GROUPED. A match is the thing the screen exists to show,
 * and two on one day are two different cars to two different grounds.
 */
export function TrainingBlock({
  events,
  isCoach,
}: {
  events: HomeEvent[]
  isCoach: boolean
}) {
  const first = events[0]
  const when = new Date(first.starts_at)

  // One venue if they share it, which they usually do, and nothing if they
  // do not — rather than naming three grounds in a row that is meant to be
  // shorter than three rows.
  const venues = [...new Set(events.map((e) => e.venue).filter(Boolean))]
  const venue = venues.length === 1 ? venues[0] : null

  const owed = events.reduce((n, e) => n + Math.max(e.my_children - e.my_replies, 0), 0)

  return (
    <article className="card">
      <div className="ev-top">
        <Link href={`/calendar/${first.id}`} className="datechip">
          <div className="d">{when.getDate()}</div>
          <div className="m">{when.toLocaleDateString('en-AU', { weekday: 'short' })}</div>
        </Link>

        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex flex-wrap items-center gap-1.5">
            <span className="typechip">training</span>
            <span className="badge">{events.length} squads</span>
          </div>
          <div className="ev-ttl">
            {/* The earliest time, because that is when the first family has
                to leave the house. */}
            From {when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
            {venue ? ` · ${venue}` : ''}
          </div>
        </div>
      </div>

      {/* Each squad still its own row and its own link — the grouping is
          about repetition, not about burying a session. */}
      <div className="stack">
        {events.map((e) => (
          <Link
            key={e.id}
            href={`/calendar/${e.id}`}
            className="flex items-baseline gap-2 text-sm"
          >
            <span className="w-16 flex-none tabular-nums text-ink-3">
              {new Date(e.starts_at).toLocaleTimeString('en-AU', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <span className="min-w-0 flex-1 truncate">{e.team_name ?? e.title}</span>
            {isCoach && e.no_reply ? (
              <span className="flex-none text-xs text-ink-3">{e.no_reply} quiet</span>
            ) : null}
          </Link>
        ))}
      </div>

      {/* No evening total for a coach: the per-squad counts are on the rows
          directly above it, and "26 across the evening" next to "17 / 4 / 5"
          is the same fact twice — the per-squad one being the one they can
          act on. A parent gets a total because their rows carry a child
          count, not a squad one. */}
      {!isCoach && owed > 0 && (
        <p className="ev-sub">
          <span className="pill">{owed} to answer</span>
        </p>
      )}
    </article>
  )
}

/**
 * Group an evening's training, leave everything else alone.
 *
 * Returns a list of either a single event or a block of them, in the order
 * the events arrived — so a day with training at 5 and a match at 7 keeps
 * them in that order rather than hoisting the block.
 */
export function groupTraining(
  events: HomeEvent[]
): ({ kind: 'one'; event: HomeEvent } | { kind: 'training'; events: HomeEvent[] })[] {
  const out: ({ kind: 'one'; event: HomeEvent } | { kind: 'training'; events: HomeEvent[] })[] = []
  const blocks = new Map<string, HomeEvent[]>()

  for (const e of events) {
    // Only training, and only when it is not something a family has been
    // told about separately: a cancelled session is news, and news does not
    // get folded into a summary.
    if (e.type !== 'training' || e.cancelled_at) {
      out.push({ kind: 'one', event: e })
      continue
    }
    const day = new Date(e.starts_at).toDateString()
    const existing = blocks.get(day)
    if (existing) {
      existing.push(e)
      continue
    }
    const block: HomeEvent[] = [e]
    blocks.set(day, block)
    out.push({ kind: 'training', events: block })
  }

  // A single session is not a block. Grouping one thing adds a layer and
  // takes away the card it would otherwise have had.
  return out.map((item) =>
    item.kind === 'training' && item.events.length === 1
      ? { kind: 'one' as const, event: item.events[0] }
      : item
  )
}
