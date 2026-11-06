'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { takeEarly } from '@/lib/early'
import { createClient } from '@/lib/supabase/client'
import { getOrg, setOrg } from '@/lib/org'
import { invalidateScreen } from '@/lib/hooks/use-screen'
import { DEFAULT_TZ } from '@/lib/time'

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
type Persona = 'parent' | 'coach' | 'owner' | 'league'
type Jobs = {
  academy_id: string
  role: string | null
  persona: Persona
  jobs: Job[]
  today: Today | null
  announcement: Announcement | null
  switch: Elsewhere[]
}

const HEADING: Record<Persona, string> = {
  parent: 'Your jobs',
  coach: 'Coaching',
  owner: 'Run the club',
  league: 'Run the league',
}

const PERSONA_WORD: Record<Persona, string> = {
  parent: 'Parent',
  coach: 'Coach',
  owner: 'Admin',
  league: 'Organiser',
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
  const [data, setData] = useState<Jobs | null>(null)
  const [setup, setSetup] = useState<Setup | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const supabase = createClient()
      const org = getOrg() ?? undefined
      const { data } = await takeEarly(`home_jobs:${org ?? ''}`, () => supabase.rpc('home_jobs', { p_academy: org }))
      if (!live) return
      const jobs = (data as unknown as Jobs | null) ?? null
      setData(jobs)
      if (jobs) onJobs?.({ persona: jobs.persona, jobs: jobs.jobs ?? [] })
      // G-01: a club still being set up gets the checklist first.
      if (jobs?.persona === 'owner') {
        const { data: s } = await supabase.rpc('setup_progress', { p_academy: getOrg() ?? undefined })
        if (live) setSetup((s as unknown as Setup | null) ?? null)
      }
    })()
    return () => {
      live = false
    }
    // onJobs is a state setter from Home; stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  return (
    <section className="px-3.5 pt-4" data-persona={data.persona}>
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
        </>
      )}

      {data.persona === 'parent' && ann && (
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
