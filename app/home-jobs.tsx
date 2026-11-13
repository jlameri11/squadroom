'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getOrg, setOrg } from '@/lib/org'
import { invalidateScreen, useScreen } from '@/lib/hooks/use-screen'
import { DEFAULT_TZ } from '@/lib/time'
import { WhenOn } from '@/components/when-on'
import { RoleRequests } from '@/app/admin/requests/role-requests'

type Job = { id: string; label: string; detail: string | null; href: string; count: number }
type Today = { label: string; detail: string; count: number; href: string }
type Announcement = {
  id: string
  channel_id: string
  channel_name: string | null
  body: string | null
  sender_name: string | null
  created_at: string
  reply_count: number
  /** 0217: the day it was about; Home stops showing it after (the database already filters). */
  relevant_until?: string | null
}
type Elsewhere = {
  id: string
  name: string
  type: string
  role: string
  persona: Persona
  primary_colour: string | null
}
type Persona = 'parent' | 'coach' | 'owner' | 'league' | 'president' | 'treasurer' | 'registrar' | 'coordinator' | 'manager' | 'welfare' | 'volunteers' | 'player'
type Jobs = {
  academy_id: string
  role: string | null
  persona: Persona
  /** 0237: every hat this person wears here, biggest first. */
  hats?: Persona[]
  jobs: Job[]
  today: Today | null
  announcement: Announcement | null
  switch: Elsewhere[]
}

const HEADING: Record<Persona, string> = {
  parent: 'Your jobs',
  player: 'Your games',
  coach: 'Coaching',
  owner: 'Run the club',
  league: 'Run the league',
  president: 'Club HQ',
  treasurer: 'The money',
  registrar: 'Registrations',
  coordinator: 'Your age groups',
  manager: 'Your team',
  welfare: 'Welfare',
  volunteers: 'Volunteers',
}

const PERSONA_WORD: Record<Persona, string> = {
  parent: 'Parent',
  player: 'Player',
  coach: 'Coach',
  owner: 'Admin',
  league: 'Organiser',
  president: 'President',
  treasurer: 'Treasurer',
  registrar: 'Registrar',
  coordinator: 'Coordinator',
  manager: 'Team manager',
  welfare: 'Welfare officer',
  volunteers: 'Volunteers',
}

/** The hat being worn on this organisation's Home, remembered per organisation (0237). */
const hatKey = (org: string) => `squadroom.hat:${org}`
export function rememberedHat(org: string | null): string | undefined {
  try {
    return (org && localStorage.getItem(hatKey(org))) || undefined
  } catch {
    return undefined
  }
}

/**
 * The top of Home: who you are here, and the three things you are here to do.
 *
 * Product direction (CLAUDE.md, 2 Nov 2026). One strip, driven by
 * `home_jobs`, which decides from the membership which of the four people is
 * looking — parent, coach, owner, league organiser — and answers with that
 * person's three jobs, each already pointing at the exact page that does it.
 * A tile is one tap; the thing on the page it opens is the second. Nothing
 * here is greyed out: a job that is not this person's is not shown at all.
 *
 * For somebody who belongs to more than one organisation, the chips above
 * the tiles are the one-tap switch. The crest in the app bar still opens the
 * full sheet; this is the shortcut for the coach who also runs the league.
 */
type Setup = { done: number; total: number; minutes: number; complete: boolean; completed_at: string | null; grandfathered?: boolean }

/** What Home hands to Needs you for a parent: the jobs, already pointing at the exact page. */
export type JobsHandoff = { persona: Persona; jobs: Job[] }

/** An announcement is news for a fortnight; after that it is history, and history is in the channel. */
export const ANNOUNCEMENT_DAYS = 14
export const isFreshAnnouncement = (createdAt: string, now = Date.now()) =>
  now - new Date(createdAt).getTime() < ANNOUNCEMENT_DAYS * 864e5

export function HomeJobs({ onJobs }: { onJobs?: (jobs: JobsHandoff) => void }) {
  const [hat, setHat] = useState<string | undefined>(() => rememberedHat(getOrg()))
  // Cached with the screen (the "Feels instant" pass): the last answer paints
  // at once. Home starts this request before the card mounts with the SAME
  // arguments, so the card joins it instead of asking twice — which it did
  // for months, the early call having no persona (time-screens, 13 Nov 2026).
  const org = getOrg() ?? undefined
  const { data } = useScreen<Jobs>('home_jobs', { p_academy: org, p_persona: hat })
  // G-01: a club still being set up gets the checklist first.
  const persona = data?.persona
  const { data: setup } = useScreen<Setup>('setup_progress', { p_academy: org }, { enabled: persona === 'owner' || persona === 'president' })
  useEffect(() => {
    if (data) onJobs?.({ persona: data.persona, jobs: data.jobs ?? [] })
    // onJobs is a state setter from Home; stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function wear(next: string) {
    try {
      const org = getOrg()
      if (org) localStorage.setItem(hatKey(org), next)
    } catch {}
    invalidateScreen()
    setHat(next)
  }

  if (!data || !data.jobs?.length) return null

  function switchTo(id: string) {
    setOrg(id)
    invalidateScreen()
    window.location.replace('/')
  }

  // Hidden once it is a fortnight old (Joey, 4 Nov 2026): a parent was
  // reading about a presentation day two months gone at the top of Home.
  const ann = data.announcement && isFreshAnnouncement(data.announcement.created_at) ? data.announcement : null
  // A parent's jobs are rows in Needs you, not a strip above it: one list.
  const tiles = data.persona !== 'parent'
  const hats = (data.hats ?? []).filter((h) => h in PERSONA_WORD)

  return (
    <section className="px-3.5 pt-4" data-persona={data.persona}>
      {/* Several hats here (0237): the one being worn is filled; a tap wears another. */}
      {hats.length > 1 && (
        <div className="-mx-3.5 mb-3 flex gap-2 overflow-x-auto px-3.5 pb-0.5" role="group" aria-label="Which hat" data-hats={hats.length}>
          {hats.map((h) => (
            <button
              key={h}
              data-hat={h}
              aria-pressed={h === data.persona}
              onClick={() => h !== data.persona && wear(h)}
              className="flex-none rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={h === data.persona
                ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }
                : { borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-2)' }}
            >
              {PERSONA_WORD[h]}
            </button>
          ))}
        </div>
      )}
      {data.switch.length > 0 && (
        <div className="-mx-3.5 mb-3 flex gap-2 overflow-x-auto px-3.5 pb-0.5" role="group" aria-label="Switch organisation">
          <span
            className="flex-none rounded-full px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {PERSONA_WORD[data.persona]} here
          </span>
          {data.switch.map((o) => (
            <button
              key={o.id}
              data-switch={o.id}
              onClick={() => switchTo(o.id)}
              className="flex-none rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink-2)' }}
            >
              {o.name} · {PERSONA_WORD[o.persona]}
            </button>
          ))}
        </div>
      )}

      {setup && !setup.complete && !setup.completed_at && (
        <Link
          href="/start/setup"
          data-setup-card
          className="card mb-3 flex items-center gap-3 p-3.5"
          style={{ borderColor: 'var(--brand)' }}
        >
          <span className="display grid h-9 w-9 flex-none place-items-center rounded-full text-sm" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            {setup.done}/{setup.total}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Finish setting up the club</span>
            <span className="block text-xs text-ink-3">{setup.total - setup.done} steps left · {setup.minutes} min so far · aim for under 30</span>
          </span>
          <span className="flex-none text-lg text-ink-3">›</span>
        </Link>
      )}

      {tiles && (
        <>
          <div className="sect">
            <span className="eyebrow">{HEADING[data.persona]}</span>
            {data.today && (
              <Link href={data.today.href} className="text-xs text-ink-3 underline underline-offset-2" data-today>
                {data.today.label}: {data.today.detail}
              </Link>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {data.jobs.map((j) => (
              <Link
                key={j.id}
                href={j.href}
                data-job={j.id}
                className="card flex min-h-[5.5rem] flex-col justify-between p-2.5"
              >
                <span className="flex items-start justify-between gap-1">
                  <span className="text-sm font-semibold leading-tight" style={{ color: 'var(--brand-text)' }}>
                    {j.label}
                  </span>
                  {j.count > 0 && <span className="pill flex-none">{j.count}</span>}
                </span>
                <span className="mt-1 line-clamp-2 text-[0.6875rem] leading-snug text-ink-3">{j.detail}</span>
              </Link>
            ))}
          </div>
          {/* 0256: the role requests this person may decide, Approve / Decline on Club HQ itself. */}
          {(data.persona === 'owner' || data.persona === 'president' || data.persona === 'coordinator') && (
            <WhenOn feature="role_requests"><RoleRequests onHome /></WhenOn>
          )}
        </>
      )}

      {(data.persona === 'parent' || data.persona === 'player') && ann && (
        <Link
          href={`/chat/${ann.channel_id}`}
          data-announcement
          className="card block p-3.5"
          style={{ borderColor: 'var(--brand)' }}
        >
          <span className="eyebrow">Latest announcement · {ann.channel_name}</span>
          <span className="mt-1.5 block text-sm font-medium">{ann.body ?? 'An announcement'}</span>
          <span className="mt-1 block text-xs text-ink-3">
            {ann.sender_name ?? 'Coach'} · {when(ann.created_at)}
            {ann.reply_count > 0 ? ` · ${ann.reply_count} ${ann.reply_count === 1 ? 'reply' : 'replies'}` : ''}
          </span>
        </Link>
      )}
    </section>
  )
}

function when(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', { timeZone: DEFAULT_TZ, weekday: 'short', day: 'numeric', month: 'short' })
}
