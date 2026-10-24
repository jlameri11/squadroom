'use client'

import { useState } from 'react'

export type Fixture = {
  id: string
  starts_at: string | null
  round: string | null
  division: string | null
  group_label: string | null
  venue: string | null
  field: string | null
  home: string | null
  away: string | null
  home_score: number | null
  away_score: number | null
  status: string
}

export type LadderRow = {
  entry_id: string
  team_name: string
  group_label: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_difference: number
  points: number
}

export type Centre = {
  competition: { name: string; season: string | null; organiser: string }
  fixtures: Fixture[]
  ladder: Record<string, LadderRow[]>
  divisions: string[]
}

const SYDNEY = 'Australia/Sydney'

/**
 * The public page.
 *
 * Written for a child on a phone, standing up, who wants one of two things:
 * when is my next game, and did we win. So those are the two tabs, and
 * Results opens on the most recent weekend rather than the first one of the
 * season — a season's draw read from the top is forty games of history
 * before you reach today.
 *
 * Nothing here is interactive beyond choosing what to look at. There is no
 * sign-in prompt, nothing to tap that asks who you are, and no analytics.
 */
export function MatchCentre({ centre }: { centre: Centre }) {
  const { competition, fixtures, ladder, divisions } = centre
  const [division, setDivision] = useState(divisions[0] ?? '')
  const [tab, setTab] = useState<'fixtures' | 'ladder'>('fixtures')

  const mine = divisions.length > 1 ? fixtures.filter((f) => f.division === division) : fixtures

  return (
    <main className="mx-auto w-full max-w-lg pb-12">
      <header
        className="px-5 pb-5 pt-7"
        style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
      >
        <p className="eyebrow" style={{ color: '#ffffffaa' }}>
          {competition.organiser}
        </p>
        <h1 className="display mt-1 text-[30px] leading-none">{competition.name}</h1>
        {competition.season && (
          <p className="mt-1.5 text-sm" style={{ color: '#ffffffb3' }}>
            {competition.season}
          </p>
        )}
      </header>

      {divisions.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3.5 pt-3.5 pb-1">
          {divisions.map((d) => (
            <button
              key={d}
              onClick={() => setDivision(d)}
              className="flex-none rounded-full px-3.5 py-1.5 text-sm font-semibold"
              style={
                division === d
                  ? { background: 'var(--brand)', color: '#fff' }
                  : { background: 'var(--surface-2)', color: 'var(--ink-2)' }
              }
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1.5 px-3.5 py-2.5">
        {(['fixtures', 'ladder'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 rounded-xl px-3 py-2 text-sm font-semibold"
            style={
              tab === t
                ? { background: 'var(--surface-2)', color: 'var(--ink)' }
                : { background: 'transparent', color: 'var(--ink-3)' }
            }
          >
            {t === 'fixtures' ? 'Fixtures & results' : 'Ladder'}
          </button>
        ))}
      </div>

      {tab === 'fixtures' ? (
        <Fixtures fixtures={mine} />
      ) : (
        <Ladder rows={ladder[division] ?? ladder[divisions[0] ?? ''] ?? []} />
      )}

      <p className="px-6 pt-6 text-center text-xs text-ink-3">
        Clubs and scores only. No player names are published here.
      </p>
    </main>
  )
}

function Fixtures({ fixtures }: { fixtures: Fixture[] }) {
  if (fixtures.length === 0) {
    return <Empty>No draw published yet.</Empty>
  }

  // Grouped the way the competition is actually read: by round when it runs
  // over weeks, by kick-off time when it is one day. Same reasoning as the
  // organiser's run sheet — ten Sundays all headed "9:00 am" distinguishes
  // nothing, and a gala day grouped by round hides which field to walk to.
  const days = new Set(
    fixtures.filter((f) => f.starts_at).map((f) => dayKey(f.starts_at as string))
  )
  const byRound = days.size > 1

  const groups = new Map<string, Fixture[]>()
  for (const f of fixtures) {
    const key = byRound ? (f.round ?? 'Not scheduled') : (f.starts_at ?? 'unscheduled')
    groups.set(key, [...(groups.get(key) ?? []), f])
  }

  const sections = [...groups.entries()]

  // Open on the round nearest today, not on Round 1. A season read from the
  // top is forty games of history before you reach this weekend, and the
  // person opening this page on a Saturday wants today.
  const todayKey = dayKey(new Date().toISOString())
  const current = Math.max(
    0,
    sections.findIndex(([, games]) =>
      games.some((g) => g.starts_at && dayKey(g.starts_at) >= todayKey)
    )
  )

  return (
    <div>
      {sections.map(([label, games], i) => (
        <section key={label} id={i === current ? 'now' : undefined}>
          <h2 className="sticky top-0 flex items-baseline gap-2 border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide backdrop-blur"
              style={{
                background: 'color-mix(in srgb, var(--surface-3) 94%, transparent)',
                borderColor: 'var(--line-2)',
                color: 'var(--ink-2)',
              }}>
            {byRound ? (
              <>
                <span>{label}</span>
                <span className="font-normal normal-case tracking-normal text-ink-3">
                  {dayOf(games)}
                </span>
              </>
            ) : (
              <span>{label === 'unscheduled' ? 'Not scheduled' : clock(label)}</span>
            )}
          </h2>

          {games.map((f) => {
            const played = f.status === 'final' && f.home_score !== null
            const homeWon = played && (f.home_score ?? 0) > (f.away_score ?? 0)
            const awayWon = played && (f.away_score ?? 0) > (f.home_score ?? 0)
            return (
              <div
                key={f.id}
                className="flex items-center gap-2.5 border-b px-4 py-3"
                style={{ borderColor: 'var(--line-2)' }}
              >
                <span className="w-12 flex-none text-xs tabular-nums text-ink-3">
                  {byRound ? (f.starts_at ? clock(f.starts_at) : '') : (f.field ?? '')}
                </span>

                <span className="min-w-0 flex-1 text-sm leading-snug">
                  <span className={homeWon ? 'font-semibold' : ''}>{f.home ?? 'TBC'}</span>
                  <span className="text-ink-3"> v </span>
                  <span className={awayWon ? 'font-semibold' : ''}>{f.away ?? 'TBC'}</span>
                  {(f.venue || (byRound && f.field)) && (
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      {[f.venue, byRound ? f.field : null].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>

                {played ? (
                  <span
                    className="flex-none text-sm font-bold tabular-nums"
                    style={{ color: 'var(--brand)' }}
                  >
                    {f.home_score}–{f.away_score}
                  </span>
                ) : (
                  <span className="flex-none text-xs text-ink-3">
                    {f.starts_at && !byRound ? '' : 'to play'}
                  </span>
                )}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

function Ladder({ rows }: { rows: LadderRow[] }) {
  if (rows.length === 0) {
    return <Empty>No ladder yet — it appears once results are in.</Empty>
  }

  // Groups within a division get their own table, because a combined one
  // ordered by points is not a ladder anybody recognises.
  const groups = new Map<string, LadderRow[]>()
  for (const r of rows) groups.set(r.group_label ?? '', [...(groups.get(r.group_label ?? '') ?? []), r])

  return (
    <div className="px-3.5">
      {[...groups.entries()].map(([group, table]) => (
        <div key={group} className="mb-4">
          {group && <h3 className="eyebrow px-1 pb-1.5">Group {group}</h3>}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-ink-3">
                  <th className="px-3 py-2 text-left font-semibold">Team</th>
                  <th className="px-1.5 py-2 text-right font-semibold">P</th>
                  <th className="px-1.5 py-2 text-right font-semibold">W</th>
                  <th className="px-1.5 py-2 text-right font-semibold">D</th>
                  <th className="px-1.5 py-2 text-right font-semibold">L</th>
                  {/* Goal difference earns its column; goals for and against
                      do not, at this width. */}
                  <th className="px-1.5 py-2 text-right font-semibold">GD</th>
                  <th className="px-3 py-2 text-right font-semibold">Pts</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={r.entry_id} className="border-t" style={{ borderColor: 'var(--line-2)' }}>
                    <td className="px-3 py-2.5">
                      <span className="mr-2 tabular-nums text-ink-3">{i + 1}</span>
                      {r.team_name}
                    </td>
                    <td className="px-1.5 py-2.5 text-right tabular-nums text-ink-2">{r.played}</td>
                    <td className="px-1.5 py-2.5 text-right tabular-nums text-ink-2">{r.won}</td>
                    <td className="px-1.5 py-2.5 text-right tabular-nums text-ink-2">{r.drawn}</td>
                    <td className="px-1.5 py-2.5 text-right tabular-nums text-ink-2">{r.lost}</td>
                    <td className="px-1.5 py-2.5 text-right tabular-nums text-ink-2">
                      {r.goal_difference > 0 ? `+${r.goal_difference}` : r.goal_difference}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {/* Said plainly, because the organiser's spreadsheet did the same and
          people asked about it every year. */}
      <p className="px-1 pt-1 text-xs text-ink-3">
        3 points for a win, 1 for a draw. Separated by goal difference, then goals scored. Teams
        level after that are shown level for the organiser to rule on.
      </p>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="m-4 rounded-xl p-6 text-center text-sm text-ink-2"
      style={{ background: 'var(--surface-2)' }}
    >
      {children}
    </p>
  )
}

/** The calendar date in Sydney, for comparing one day to another. */
function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: SYDNEY })
}

function clock(iso: string) {
  return new Date(iso)
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: SYDNEY })
    .replace(' ', '')
    .toLowerCase()
}

/** "Sun 30 Aug" — the weekend a round is played on. */
function dayOf(games: Fixture[]) {
  const when = games.find((g) => g.starts_at)?.starts_at
  if (!when) return ''
  return new Date(when).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: SYDNEY,
  })
}
