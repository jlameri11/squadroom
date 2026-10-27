'use client'

import { type UpcomingEvent } from './calendar-list'

export type DrawFilter = { day: string | null; team: string | null }

/**
 * F-02. The controls that turn a fixture list into a draw.
 *
 * A coach on a Friday night has one question — "who is playing where
 * tomorrow" — and a 60-day list grouped by day is the wrong shape for it. A
 * club secretary has the other one: "show me the U10s, all of it".
 *
 * Both chip rows are DERIVED FROM THE FIXTURES IN VIEW, never from a list of
 * days or a list of squads. That is the whole design:
 *
 *   - every chip has fixtures behind it, so nothing offered returns nothing;
 *   - a squad that has ended but still has a game in the window is offered,
 *     and a squad with a full roster and no games is not;
 *   - the count on each chip is the real number, so a coach can see the shape
 *     of the weekend without opening it.
 *
 * Both narrow independently and both show a count of what is left, because a
 * filtered list that does not say it is filtered is a list with fixtures
 * missing.
 */
export function DrawFilters({
  events,
  filter,
  onChange,
}: {
  events: UpcomingEvent[]
  filter: DrawFilter
  onChange: (f: DrawFilter) => void
}) {
  // Days, in order, with a count each. Only the next eight, because a chip
  // row is for picking a match day and not for scrolling through a season —
  // clearing the filter is how you see the rest.
  const dayCounts = new Map<string, number>()
  for (const e of events) {
    const key = new Date(e.starts_at).toDateString()
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }
  const days = [...dayCounts.keys()].slice(0, 8)

  // Squads present in the window. Counted against the DAY filter when one is
  // set, so the two controls describe the same list: picking Saturday and
  // then seeing "U14 · 3" when U14 do not play on Saturday would be a lie
  // told by a control about its own effect.
  const inDay = filter.day
    ? events.filter((e) => new Date(e.starts_at).toDateString() === filter.day)
    : events
  const teamCounts = new Map<string, number>()
  for (const e of inDay) {
    if (!e.team_name) continue
    teamCounts.set(e.team_name, (teamCounts.get(e.team_name) ?? 0) + 1)
  }
  const teams = [...teamCounts.keys()].sort()

  // One squad and one day is not a draw, it is a fixture. Nothing to filter.
  if (days.length < 2 && teams.length < 2) return null

  return (
    <div
      className="border-b backdrop-blur"
      style={{ background: 'var(--paper-blur)', borderColor: 'var(--line-2)' }}
    >
      {days.length > 1 && (
        <Row label="Day">
          <Chip on={filter.day === null} onClick={() => onChange({ ...filter, day: null })}>
            All days
          </Chip>
          {days.map((d) => (
            <Chip
              key={d}
              on={filter.day === d}
              count={dayCounts.get(d)}
              onClick={() => onChange({ ...filter, day: filter.day === d ? null : d })}
            >
              {shortDay(d)}
            </Chip>
          ))}
        </Row>
      )}

      {teams.length > 1 && (
        <Row label="Squad">
          <Chip on={filter.team === null} onClick={() => onChange({ ...filter, team: null })}>
            All squads
          </Chip>
          {teams.map((t) => (
            <Chip
              key={t}
              on={filter.team === t}
              count={teamCounts.get(t)}
              onClick={() => onChange({ ...filter, team: filter.team === t ? null : t })}
            >
              {t}
            </Chip>
          ))}
        </Row>
      )}
    </div>
  )
}

/** Narrow a list the way the chips say. Exported so the screen and its tests
 *  cannot disagree about what a filter means. */
export function applyDrawFilter(events: UpcomingEvent[], f: DrawFilter) {
  return events.filter(
    (e) =>
      (f.day === null || new Date(e.starts_at).toDateString() === f.day) &&
      (f.team === null || e.team_name === f.team)
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2">
      <span className="eyebrow w-11 flex-none">{label}</span>
      {/* Scrolls rather than wraps: a club with nine squads is wider than a
          phone, and a second line of chips pushes the fixtures off the screen
          on every load for the sake of a control most people tap once. */}
      <div className="flex flex-1 gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {children}
      </div>
    </div>
  )
}

function Chip({
  on,
  count,
  onClick,
  children,
}: {
  on: boolean
  count?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="flex flex-none items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold"
      style={
        on
          ? {
              borderColor: 'var(--brand)',
              background: 'var(--brand-faint)',
              color: 'var(--brand)',
            }
          : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
      }
    >
      {children}
      {count !== undefined && (
        <span className="tabular-nums opacity-60">{count}</span>
      )}
    </button>
  )
}

function shortDay(day: string) {
  const d = new Date(day)
  const today = new Date().toDateString()
  const tomorrow = new Date(Date.now() + 86400000).toDateString()
  if (day === today) return 'Today'
  if (day === tomorrow) return 'Tomorrow'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}
