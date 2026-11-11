'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { WhenOn } from '@/components/when-on'
import { DEFAULT_TZ } from '@/lib/time'

type GroundDay = { event_id: string; title: string; venue: string | null; venue_id: string | null; date: string; spots: number; filled: number; open: number; games: number }
type DayWithout = { venue_id: string; venue: string; date: string; games: number }
type DutyGap = { event_id: string; team_id: string; team: string; opponent: string | null; starts_at: string; titles: number; assigned: number; swaps: number }
type Gaps = { ground_days: GroundDay[]; days_without: DayWithout[]; duties: DutyGap[]; squads_without_duties: { team_id: string; team: string }[] }

/**
 * Rosters (Big Club Mode item 10; 0252): the Volunteer coordinator's
 * fortnight. Each ground's day with its spots filled and open, the game
 * days at a drawn ground with no day set up yet (one tap sets it up with
 * the usual jobs), the games whose duties are short or asked to be
 * swapped, and the squads with no duties at all. Staff and whoever runs
 * volunteers; the database decides.
 */
export function RostersScreen() {
  const org = useCurrentOrg()
  const [gaps, setGaps] = useState<Gaps | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asked, setAsked] = useState<Record<string, number>>({})

  const load = useCallback(async (orgId: string) => {
    const { data } = await createClient().rpc('volunteer_gaps', { p_academy: orgId })
    setGaps((data as unknown as Gaps | null) ?? null)
  }, [])
  useEffect(() => {
    if (!org) return
    void load(org.id)
  }, [org, load])

  if (!org || gaps === undefined) return <ScreenSkeleton />
  if (gaps === null) return <p className="m-5 card p-5 text-center text-sm text-ink-2">Rosters are for the people who run the club and its volunteers.</p>

  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: org.timezone || DEFAULT_TZ })

  async function setUp(d: DayWithout) {
    setBusy(`${d.venue_id}:${d.date}`)
    setError(null)
    const { error } = await createClient().rpc('create_ground_day', { p_academy: org!.id, p_venue: d.venue_id, p_date: d.date })
    setBusy(null)
    if (error) return setError(error.message)
    await load(org!.id)
  }
  async function ask(g: GroundDay) {
    setBusy(g.event_id)
    setError(null)
    const { data, error } = await createClient().rpc('ask_for_helpers', { p_event: g.event_id })
    setBusy(null)
    if (error) return setError(error.message)
    setAsked({ ...asked, [g.event_id]: data as number })
  }

  return (
    <div className="p-4 pb-10" data-rosters>
      {error && <p className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}

      <section className="card p-3.5" data-ground-days={gaps.ground_days.length}>
        <div className="sect">
          <span className="eyebrow">Ground days</span>
          <span className="text-xs text-ink-3">next two weeks</span>
        </div>
        {gaps.ground_days.length === 0 && gaps.days_without.length === 0 && (
          <p className="mt-2 text-sm text-ink-2">No game days at a drawn ground in the next two weeks. Draw a ground under Venues and give games a pitch, and the days appear here.</p>
        )}
        {gaps.ground_days.length > 0 && (
          <ul className="mt-1 flex flex-col divide-y divide-[var(--line-2)]">
            {gaps.ground_days.map((g) => (
              <li key={g.event_id} className="py-2.5" data-ground-day={g.event_id}>
                <Link href={`/calendar/${g.event_id}`} className="block">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{g.venue ?? g.title}</span>
                    <span className="flex-none text-xs text-ink-3">{day(g.date)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs" style={g.open > 0 ? { color: 'var(--accent)' } : { color: 'var(--yes)' }}>
                    {g.filled} of {g.spots} spots filled{g.open > 0 ? ` · ${g.open} open` : ' · all filled'} · {g.games} {g.games === 1 ? 'game' : 'games'} there
                  </span>
                </Link>
                {g.open > 0 && (
                  <button onClick={() => ask(g)} disabled={busy !== null || asked[g.event_id] !== undefined} className="tap mt-1 text-xs font-semibold underline underline-offset-4 disabled:opacity-60" data-ask-ground={g.event_id}>
                    {asked[g.event_id] !== undefined ? `Asked ${asked[g.event_id]} people` : 'Ask the club'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {gaps.days_without.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2" data-days-without={gaps.days_without.length}>
            {gaps.days_without.map((d) => (
              <li key={`${d.venue_id}:${d.date}`} className="flex items-center justify-between gap-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--surface-2)' }}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.venue} · {day(d.date)}</span>
                  <span className="block text-xs text-ink-3">{d.games} {d.games === 1 ? 'game' : 'games'}, no jobs set</span>
                </span>
                <button onClick={() => setUp(d)} disabled={busy !== null} className="min-w-fit flex-none rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-set-up-day>
                  {busy === `${d.venue_id}:${d.date}` ? '…' : 'Set up the day'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <WhenOn feature="duty_roster">
        <section className="card mt-3 p-3.5" data-duty-gaps={gaps.duties.length}>
          <div className="sect">
            <span className="eyebrow">Duties</span>
            <span className="text-xs text-ink-3">short, or a swap asked</span>
          </div>
          {gaps.duties.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--yes)' }}>Every rostered game has its families.</p>
          ) : (
            <ul className="mt-1 flex flex-col divide-y divide-[var(--line-2)]">
              {gaps.duties.map((g) => (
                <li key={g.event_id}>
                  <Link href={`/calendar/${g.event_id}`} className="block py-2.5">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{g.team}{g.opponent ? ` v ${g.opponent}` : ''}</span>
                      <span className="flex-none text-xs text-ink-3">{when(g.starts_at)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs" style={{ color: 'var(--accent)' }}>
                      {g.assigned < g.titles ? `${g.titles - g.assigned} of ${g.titles} duties with nobody` : ''}
                      {g.assigned < g.titles && g.swaps > 0 ? ' · ' : ''}
                      {g.swaps > 0 ? `${g.swaps} ${g.swaps === 1 ? 'swap' : 'swaps'} asked for` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {gaps.squads_without_duties.length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              No duties yet: {gaps.squads_without_duties.map((t, i) => (
                <span key={t.team_id}>{i > 0 ? ', ' : ''}<Link href={`/admin/teams/${t.team_id}`} className="underline underline-offset-2">{t.team}</Link></span>
              ))}
              . Set them on the team page.
            </p>
          )}
        </section>
      </WhenOn>
    </div>
  )
}
