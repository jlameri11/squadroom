'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Program } from './programs-screen'

type Reg = { program_id: string; player_id: string; status: string; created_at: string }
type Player = { id: string; dob: string | null; gender: string | null; created_at: string }

export type Dashboard = {
  season: string
  programs: number
  registrations: { pending: number; approved: number; waitlisted: number; total: number }
  children: number
  newcomers: number
  returning: number
  ages: { label: string; count: number }[]
  genders: { label: string; count: number }[]
  places: { filled: number; capacity: number } | null
}

/**
 * Registrations at a glance (R-21): this season's sign-ups by status, how
 * many children that is, who is new to the club and who is back, their age
 * groups and gender, and places filled against capacity — the one target a
 * club has actually written down.
 *
 * Worked out in the browser from what RLS lets this person read (the
 * registrations and the players of their organisation), so nothing here is
 * a second opinion of the database's and no migration was needed. "New"
 * means the child's record was made in this season's intake — after the
 * first of this season's programs opened — rather than carried over from a
 * previous season. A season is the latest one with an open program.
 */
export function compute(programs: Program[], regs: Reg[], players: Player[]): Dashboard | null {
  const seasons = programs.map((p) => p.season).filter((s): s is string => Boolean(s))
  if (seasons.length === 0) return null
  const open = programs.filter((p) => p.status === 'open' && p.season)
  const season = (open.length ? open : programs).map((p) => p.season as string).sort().at(-1) as string
  const mine = programs.filter((p) => p.season === season)
  const ids = new Set(mine.map((p) => p.id))
  const inSeason = regs.filter((r) => ids.has(r.program_id))
  const firstOpened = mine
    .map((p) => p.opens_at ?? '')
    .filter(Boolean)
    .sort()[0]
  const byId = new Map(players.map((p) => [p.id, p]))
  const childIds = [...new Set(inSeason.map((r) => r.player_id))]
  const children = childIds.map((id) => byId.get(id)).filter((p): p is Player => Boolean(p))
  // Without an opening date there is nothing to compare against, so
  // everyone counts as returning rather than guessing.
  const newcomers = firstOpened ? children.filter((p) => p.created_at > firstOpened).length : 0
  const seasonYear = Number(season)
  const ageCounts = new Map<string, number>()
  for (const p of children) {
    const year = p.dob ? Number(p.dob.slice(0, 4)) : null
    // Football age: the age they turn in the season's year, written the way
    // a club writes it — U9 is everyone born in season − 9.
    const label = year && Number.isFinite(seasonYear) ? `U${seasonYear - year}` : 'Age not given'
    ageCounts.set(label, (ageCounts.get(label) ?? 0) + 1)
  }
  const genderCounts = new Map<string, number>()
  for (const p of children) {
    const label = p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1).replace(/_/g, ' ') : 'Not given'
    genderCounts.set(label, (genderCounts.get(label) ?? 0) + 1)
  }
  const capped = mine.filter((p) => p.capacity)
  const places = capped.length
    ? {
        filled: capped.reduce((n, p) => n + inSeason.filter((r) => r.program_id === p.id && r.status === 'approved').length, 0),
        capacity: capped.reduce((n, p) => n + (p.capacity ?? 0), 0),
      }
    : null
  const ageOrder = (a: string, b: string) => (Number(a.slice(1)) || 99) - (Number(b.slice(1)) || 99)
  return {
    season,
    programs: mine.length,
    registrations: {
      pending: inSeason.filter((r) => r.status === 'pending').length,
      approved: inSeason.filter((r) => r.status === 'approved').length,
      waitlisted: inSeason.filter((r) => r.status === 'waitlisted').length,
      total: inSeason.length,
    },
    children: children.length,
    newcomers,
    returning: children.length - newcomers,
    ages: [...ageCounts].map(([label, count]) => ({ label, count })).sort((a, b) => ageOrder(a.label, b.label)),
    genders: [...genderCounts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    places,
  }
}

export function RegistrationDashboard({ academyId, programs }: { academyId: string; programs: Program[] }) {
  const [data, setData] = useState<Dashboard | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    ;(async () => {
      const supabase = createClient()
      // The club's view, for the club's people. A parent who types this
      // address can read their own children's registrations, and a card
      // built from those would be a small, wrong club.
      const { data: claims } = await supabase.auth.getClaims()
      const me = claims?.claims?.sub
      const { data: member } = me
        ? await supabase.from('academy_members').select('role').eq('academy_id', academyId).eq('profile_id', me).eq('status', 'active').maybeSingle()
        : { data: null }
      if (!member || !['owner', 'admin', 'coach'].includes(member.role)) {
        if (live) setData(null)
        return
      }
      const [{ data: regs }, { data: players }] = await Promise.all([
        supabase.from('program_registrations').select('program_id, player_id, status, created_at').eq('academy_id', academyId),
        supabase.from('players').select('id, dob, gender, created_at').eq('academy_id', academyId),
      ])
      if (!live) return
      setData(compute(programs, (regs ?? []) as Reg[], (players ?? []) as Player[]))
    })()
    return () => {
      live = false
    }
  }, [academyId, programs])

  if (!data || data.registrations.total === 0) return null
  const r = data.registrations
  const max = Math.max(1, ...data.ages.map((a) => a.count))

  return (
    <section className="card mb-3.5 p-3.5" data-registration-dashboard data-season={data.season} data-total={r.total} data-children={data.children} data-new={data.newcomers} data-returning={data.returning} data-filled={data.places?.filled ?? ''} data-capacity={data.places?.capacity ?? ''}>
      <div className="sect">
        <span className="eyebrow">Registrations · {data.season}</span>
        <span className="text-xs text-ink-3">{data.programs} {data.programs === 1 ? 'program' : 'programs'}</span>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat n={r.approved} label="approved" />
        <Stat n={r.pending} label="to decide" tone={r.pending > 0 ? 'accent' : undefined} />
        <Stat n={r.waitlisted} label="waitlisted" />
      </div>

      <p className="mt-3 text-sm">
        <b>{data.children}</b> {data.children === 1 ? 'child' : 'children'} ·{' '}
        <b>{data.newcomers}</b> new to the club · <b>{data.returning}</b> back from last season
      </p>

      {data.places && (
        <p className="mt-1 text-sm text-ink-2" data-places>
          <b className="text-ink">{data.places.filled}</b> of <b className="text-ink">{data.places.capacity}</b> places filled where a program has a cap
        </p>
      )}

      {data.ages.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" aria-label="Children by age group">
          {data.ages.map((a) => (
            <li key={a.label} className="flex items-center gap-2 text-xs">
              <span className="w-20 flex-none text-ink-2">{a.label}</span>
              <span className="h-2 flex-none rounded-full" style={{ width: `${Math.max(6, (a.count / max) * 100)}%`, maxWidth: 'calc(100% - 7rem)', background: 'var(--brand)' }} aria-hidden />
              <span className="tabular-nums text-ink-2">{a.count}</span>
            </li>
          ))}
        </ul>
      )}

      {data.genders.length > 0 && (
        <p className="mt-2 text-xs text-ink-3">
          {data.genders.map((g) => (g.label === 'Not given' ? `gender not recorded for ${g.count}` : `${g.label} ${g.count}`)).join(' · ')}
        </p>
      )}
    </section>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: 'accent' }) {
  return (
    <span className="rounded-xl py-2" style={{ background: tone === 'accent' && n > 0 ? 'var(--accent)' : 'var(--surface-2)', color: tone === 'accent' && n > 0 ? 'var(--accent-ink)' : undefined }}>
      <b className="display block text-xl leading-none">{n}</b>
      <span className="mt-1 block text-[11px]">{label}</span>
    </span>
  )
}
