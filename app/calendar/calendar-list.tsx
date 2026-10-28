'use client'

import Link from 'next/link'

export type UpcomingEvent = {
  id: string
  type: string
  title: string
  starts_at: string
  arrive_at: string | null
  venue: string | null
  opponent: string | null
  round: string | null
  team_name: string | null
  competition: string | null
  cancelled_at: string | null
  my_replies: number
  my_children: number
  going: number | null
  no_reply: number | null
  private_to: string | null
  source: string
  confirmed_at: string | null
}

const TYPE_TINT: Record<string, string> = {
  // --brand-text, not --brand. These are TIMES, drawn as text: in dark mode
  // the raw brand is a club's own colour on a near-black ground and the
  // match times had vanished while the training times beside them were fine.
  match: 'var(--brand-text)',
  tournament: 'var(--maybe)',
  training: 'var(--ink-2)',
  social: 'var(--yes)',
  other: 'var(--ink-2)',
}

export function CalendarList({
  academyId,
  events,
  stickyTop = 0,
}: {
  academyId: string
  events: UpcomingEvent[]
  /** How far down to stick the day headings — the height of whatever is
   *  sticking above them. Screen is the scroll container, so without this
   *  they stick at the same top as the draw filter bar and disappear behind
   *  it. */
  stickyTop?: number
}) {
  if (events.length === 0) {
    return (
      <p className="card m-4 p-6 text-center text-sm text-ink-3">
        Nothing coming up for your teams.
      </p>
    )
  }

  // Grouped by day, because that is how anyone reads a fixture list.
  const days = new Map<string, UpcomingEvent[]>()
  for (const e of events) {
    const key = new Date(e.starts_at).toDateString()
    days.set(key, [...(days.get(key) ?? []), e])
  }

  return (
    <div>
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h2
            className="eyebrow sticky z-10 border-b px-4 py-2 backdrop-blur"
            style={{
              top: stickyTop,
              background: 'var(--paper-blur)',
              borderColor: 'var(--line-2)',
            }}
          >
            {dayLabel(day)}
          </h2>

          {collapseTraining(list).map((group) =>
            group.length > 1 ? (
              <TrainingRow key={group[0].id} group={group} />
            ) : (
              <Row key={group[0].id} e={group[0]} />
            )
          )}
        </section>
      ))}
    </div>
  )
}

function dayLabel(day: string) {
  const d = new Date(day)
  const today = new Date().toDateString()
  const tomorrow = new Date(Date.now() + 86400000).toDateString()
  if (day === today) return 'Today'
  if (day === tomorrow) return 'Tomorrow'
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * One fixture, exactly as this list has always drawn it.
 *
 * Extracted when training began to be collapsed, so the two shapes in the
 * list are two components rather than two branches inside a map — which is
 * how the first attempt at this turned into a `return` in the middle of
 * JSX.
 */
function Row({ e }: { e: UpcomingEvent }) {
            const cancelled = Boolean(e.cancelled_at)
            // A parent who has not answered for every child is the one thing
            // this screen should nag about.
            const owed = !cancelled && e.my_children > e.my_replies
            return (
              <Link
                key={e.id}
                href={`/calendar/${e.id}`}
                className={`row items-start ${cancelled ? 'opacity-50' : ''}`}
                style={{ borderColor: 'var(--line-2)' }}
              >
                <span className="display mt-0.5 w-14 flex-none text-[15px] tabular-nums" style={{ color: TYPE_TINT[e.type] ?? 'var(--ink-2)' }}>
                  {new Date(e.starts_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{shortTitle(e)}</span>
                    {cancelled && (
                      <span className="tag" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>Off</span>
                    )}
                    {/*
                      A game a machine read off a screenshot is not the same
                      claim as one a coach typed, and until somebody has
                      checked it, it should not look like one.
                    */}
                    {e.source === 'screenshot' && !e.confirmed_at && (
                      <span className="tag flex-none" style={{ background: 'var(--maybe-bg)', color: 'var(--maybe)' }}>
                        Check
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-ink-3">
                    {[e.team_name, e.venue, e.round, e.private_to ? 'Only you' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {e.competition && (
                    <span className="tag mt-1 inline-block">{e.competition}</span>
                  )}
                </span>

                <span className="flex-none text-right">
                  {owed && (
                    <span className="pill">{e.my_children - e.my_replies} to answer</span>
                  )}
                  {!owed && e.going !== null && (
                    <span className="text-xs text-ink-3">
                      <b style={{ color: 'var(--yes)' }}>{e.going} in</b>
                      {e.no_reply ? ` · ${e.no_reply} quiet` : ''}
                    </span>
                  )}
                </span>
              </Link>
            )
}

/**
 * An evening of training, as one row.
 *
 * A club training three squads twice a week puts about fifty near-identical
 * rows into a sixty-day window — "5:00pm U8 SPL Training", "5:30pm U10
 * Training", "6:15pm U12 Training", over and over — and a coach looking for
 * Saturday scrolled past a month of Tuesdays. The list measured thirteen
 * phone screens.
 *
 * NOTHING IS HIDDEN. Every session is named inside the row, every one is its
 * own link, and a parent still sees what they owe an answer for. What goes
 * is the repetition of the date, the ground and the word "training".
 *
 * Matches are never collapsed. A match is what the screen exists to show,
 * and two on one day are two different cars to two different grounds.
 */
function TrainingRow({ group }: { group: UpcomingEvent[] }) {
  const first = group[0]
  const venues = [...new Set(group.map((g) => g.venue).filter(Boolean))]
  const owed = group.reduce((n, g) => n + Math.max(g.my_children - g.my_replies, 0), 0)

  return (
    <div className="row items-start" style={{ borderColor: 'var(--line-2)' }}>
      <span
        className="display mt-0.5 w-14 flex-none text-[15px] tabular-nums"
        style={{ color: TYPE_TINT.training }}
      >
        {new Date(first.starts_at).toLocaleTimeString('en-AU', {
          hour: 'numeric',
          minute: '2-digit',
        })}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">Training · {group.length} squads</span>
        {venues.length === 1 && (
          <span className="block truncate text-sm text-ink-3">{venues[0]}</span>
        )}

        <span className="mt-1 flex flex-col gap-0.5">
          {group.map((g) => (
            <Link
              key={g.id}
              href={`/calendar/${g.id}`}
              className="flex items-baseline gap-2 text-sm"
            >
              <span className="w-14 flex-none tabular-nums text-ink-3">
                {new Date(g.starts_at).toLocaleTimeString('en-AU', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-2">
                {g.team_name ?? g.title}
              </span>
              {g.my_children > g.my_replies && (
                <span className="pill flex-none">{g.my_children - g.my_replies}</span>
              )}
            </Link>
          ))}
        </span>
      </span>

      {owed > 0 && (
        <span className="flex-none text-right">
          <span className="pill">{owed} to answer</span>
        </span>
      )}
    </div>
  )
}

/**
 * Consecutive training on one day becomes one group; everything else stands
 * alone.
 *
 * Consecutive, not merely same-day: training at 5 and a match at 7 must keep
 * their order, and a session after the match is a third row rather than
 * being hoisted up to join the first two.
 *
 * A cancelled session is never folded in. A called-off training is news, and
 * news does not go inside a summary.
 */
function collapseTraining(list: UpcomingEvent[]): UpcomingEvent[][] {
  const out: UpcomingEvent[][] = []
  for (const e of list) {
    const groupable = e.type === 'training' && !e.cancelled_at
    const last = out[out.length - 1]
    const lastGroupable =
      last && last[0].type === 'training' && !last[0].cancelled_at && last.length >= 1
    if (groupable && lastGroupable) last.push(e)
    else out.push([e])
  }
  return out
}

/**
 * The part of a title worth the width.
 *
 * A mirrored competition fixture is titled "SPL Season 3 — vs Chatswood
 * Chargers", and the list already shows "SPL Season 3" as a tag underneath
 * it. So the row spent its first fifteen characters repeating the tag and
 * then truncated the opponent — "SPL Season 3 — vs Chats…" — losing the one
 * word a parent is scanning for.
 *
 * Presentational only. The event keeps its full title everywhere it is read
 * on its own, including the share card and the chat card, where there is no
 * tag beside it to make the prefix redundant.
 */
function shortTitle(e: UpcomingEvent): string {
  if (!e.competition) return e.title
  const prefix = e.competition.trim()
  const title = e.title.trim()
  if (!title.toLowerCase().startsWith(prefix.toLowerCase())) return e.title
  // Whatever separator the title used — an em dash, a hyphen, a colon.
  const rest = title.slice(prefix.length).replace(/^\s*[—–\-:·]\s*/, '').trim()
  return rest || e.title
}
