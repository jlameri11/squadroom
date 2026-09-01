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
}

const TYPE_TINT: Record<string, string> = {
  match: '#202842',
  tournament: '#9C6B06',
  training: '#6B7280',
  social: '#1C7A4C',
  other: '#6B7280',
}

export function CalendarList({ academyId, events }: { academyId: string; events: UpcomingEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="m-5 rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
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
          <h2 className="sticky top-0 border-b border-neutral-100 bg-neutral-50/95 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 backdrop-blur">
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
                className={`flex items-start gap-3 border-b border-neutral-100 px-5 py-3 ${cancelled ? 'opacity-50' : ''}`}
              >
                <span className="mt-0.5 w-14 flex-none text-sm font-semibold tabular-nums" style={{ color: TYPE_TINT[e.type] ?? '#6B7280' }}>
                  {new Date(e.starts_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{e.title}</span>
                    {cancelled && <span className="text-xs font-semibold text-red-600">Cancelled</span>}
                  </span>
                  <span className="block truncate text-sm text-neutral-500">
                    {[e.team_name, e.venue, e.round].filter(Boolean).join(' · ')}
                  </span>
                  {e.competition && (
                    <span className="mt-0.5 inline-block rounded bg-neutral-100 px-1.5 py-px text-[10px] text-neutral-600">
                      {e.competition}
                    </span>
                  )}
                </span>

                <span className="flex-none text-right">
                  {owed && (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: '#DD5620' }}>
                      {e.my_children - e.my_replies} to answer
                    </span>
                  )}
                  {!owed && e.going !== null && (
                    <span className="text-xs text-neutral-500">
                      <b style={{ color: '#1C7A4C' }}>{e.going} in</b>
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
