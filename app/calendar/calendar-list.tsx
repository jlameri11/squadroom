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
  match: 'var(--brand)',
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

          {list.map((e) => {
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
                    <span className="truncate font-medium">{e.title}</span>
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
          })}
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
