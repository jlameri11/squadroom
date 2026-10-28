'use client'

import { type UpcomingEvent } from './calendar-list'

export type DrawFilter = {
  day: string | null
  team: string | null
  /** 'games' hides training, 'training' shows only it, null is everything. */
  what: 'games' | 'training' | null
}

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
 * THE THIRD ROW EXISTS BECAUSE OF WHAT THIS SCREEN ACTUALLY LOOKS LIKE. A
 * club training three squads twice a week has about fifty training sessions
 * in a sixty-day window and maybe a dozen games — so the fixture list
 * measured thirteen phone screens tall, almost all of it the same three rows
 * repeating. A coach looking for Saturday scrolled past a month of Tuesdays.
 *
 * Nothing is hidden by default. "Games" is one tap, and the screen says how
 * many it is showing out of how many.
 *
 * All three narrow independently and all show a count of what is left,
 * because a filtered list that does not say it is filtered is a list with
 * fixtures missing.
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
  // Counted against the KIND filter, so picking "Games" and then reading
  // "Sat 1 Nov · 9" does not promise nine when six of them are training.
  const ofKind =
    filter.what === null
      ? events
      : events.filter((e) =>
          filter.what === 'training' ? e.type === 'training' : e.type !== 'training'
        )

  const dayCounts = new Map<string, number>()
  for (const e of ofKind) {
    const key = new Date(e.starts_at).toDateString()
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)
  }
  const days = [...dayCounts.keys()].slice(0, 8)

  // Squads present in the window. Counted against the DAY filter when one is
  // set, so the two controls describe the same list: picking Saturday and
  // then seeing "U14 · 3" when U14 do not play on Saturday would be a lie
  // told by a control about its own effect.
  const inDay = filter.day
    ? ofKind.filter((e) => new Date(e.starts_at).toDateString() === filter.day)
    : ofKind
  const teamCounts = new Map<string, number>()
  for (const e of inDay) {
    if (!e.team_name) continue
    teamCounts.set(e.team_name, (teamCounts.get(e.team_name) ?? 0) + 1)
  }
  const teams = [...teamCounts.keys()].sort()

  // How many are games and how many are training, from the same list the
  // chips narrow — so the counts cannot disagree with what a tap produces.
  const games = events.filter((e) => e.type !== 'training').length
  const training = events.length - games
  const bothKinds = games > 0 && training > 0

  // One squad, one day and one kind is not a draw, it is a fixture.
  if (days.length < 2 && teams.length < 2 && !bothKinds) return null

  return (
    <div
      className="border-b backdrop-blur"
      style={{ background: 'var(--paper-blur)', borderColor: 'var(--line-2)' }}
    >
      {/* First, because it is the one that changes the screen most. */}
      {bothKinds && (
        <Row label="Show">
          <Chip on={filter.what === null} onClick={() => onChange({ ...filter, what: null })}>
            Everything
          </Chip>
          <Chip
            on={filter.what === 'games'}
            count={games}
            onClick={() => onChange({ ...filter, what: filter.what === 'games' ? null : 'games' })}
          >
            Games
          </Chip>
          <Chip
            on={filter.what === 'training'}
            count={training}
            onClick={() =>
              onChange({ ...filter, what: filter.what === 'training' ? null : 'training' })
            }
          >
            Training
          </Chip>
        </Row>
      )}

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
      (f.team === null || e.team_name === f.team) &&
      (f.what === null ||
        (f.what === 'training' ? e.type === 'training' : e.type !== 'training'))
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
              color: 'var(--brand-text)',
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
