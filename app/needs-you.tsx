'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { takeEarly } from '@/lib/early'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import type { JobsHandoff } from './home-jobs'

type Item = {
  kind: string
  title: string
  detail: string | null
  href: string
  count: number
  urgent: boolean
  /** Which of the person's jobs this row is, for the two-tap rule. */
  job?: string
}

/**
 * The things waiting on this person, at the top of the home screen.
 *
 * Not navigation — the tab bar is five destinations and stays five. This is
 * the specific work outstanding right now, each row a link to where it is
 * dealt with.
 *
 * It exists because an audit of the navigation found that `/payments` and
 * `/programs` were linked from NOWHERE. A parent could not find their bills
 * and could not find anything to sign up to: two whole features invisible to
 * the only people who use them. A strip of prompts fixes that without adding
 * a sixth tab or turning the home screen into a menu.
 *
 * NOTHING WHEN THERE IS NOTHING. A strip that renders "0 outstanding" is a
 * strip that is always there, and the home screen is worth more when most
 * people see none of this.
 *
 * Simplicity pass (Joey, 4 Nov 2026): ONE orange card — the most urgent —
 * and plain rows for the rest; and for a parent, their three jobs live here
 * as rows rather than in a strip above (one list, never both). The number
 * on "to answer" is the one Home uses everywhere: games and sessions in the
 * next three weeks that a child of theirs has not been answered for.
 */
export function NeedsYou({ jobs }: { jobs?: JobsHandoff | null }) {
  const [items, setItems] = useState<Item[] | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      // `?? undefined`, because getOrg returns null for "no preference" and
      // the generated signature takes an optional uuid rather than a
      // nullable one.
      const org = getOrg() ?? undefined
      const { data } = await takeEarly(`needs_you:${org ?? ''}`, () => createClient().rpc('needs_you', { p_academy: org }))
      if (!live) return
      setItems((data ?? []) as Item[])
    })()
    return () => {
      live = false
    }
  }, [])

  if (!items) return null

  const shown = jobs?.persona === 'parent' ? withJobs(items, jobs.jobs) : items
  if (shown.length === 0) return null

  // The database orders them by urgency (money and consents first). The
  // first urgent one is the card; everything else is a row.
  const lead = shown.find((i) => i.urgent) ?? null
  const rest = shown.filter((i) => i !== lead)

  return (
    <section className="px-4 pb-1 pt-4" data-needs-you>
      <h2 className="eyebrow px-1 pb-2">Needs you</h2>

      <div className="flex flex-col gap-2">
        {lead && (
          <Link
            href={lead.href}
            data-job={lead.job}
            className="flex items-center gap-3 rounded-[14px] p-3.5 text-sm"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--shadow)' }}
          >
            <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-white/25 text-base">
              {lead.count}
            </span>
            <span className="min-w-0">
              <b className="block truncate">{lead.title}</b>
              {lead.detail && <span className="block truncate opacity-90">{lead.detail}</span>}
            </span>
            <span className="ml-auto flex-none text-lg opacity-80">›</span>
          </Link>
        )}

        {rest.length > 0 && (
          <ul className="card overflow-hidden">
            {rest.map((i) => (
              <li key={i.kind}>
                <Link href={i.href} className="row justify-between" data-job={i.job}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.title}</span>
                    {i.detail && (
                      <span className="block truncate text-sm text-ink-3">{i.detail}</span>
                    )}
                  </span>
                  {i.count > 0 && i.kind === 'chat' && <span className="pill ml-auto flex-none">{i.count}</span>}
                  <span className="flex-none text-lg text-ink-3">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/**
 * A parent's jobs as rows: "to answer" takes the jobs' count (the one number
 * Home uses everywhere) and points at the next unanswered game; "fees to pay"
 * is the row Needs you already has; team chat appears only while something
 * is unread, but the row is always there: it is one of the three jobs.
 */
function withJobs(items: Item[], jobs: JobsHandoff['jobs']): Item[] {
  const out: Item[] = []
  const rsvp = jobs.find((j) => j.id === 'rsvp')
  const pay = jobs.find((j) => j.id === 'pay')
  const chat = jobs.find((j) => j.id === 'chat')
  let placedRsvp = false
  for (const i of items) {
    if (i.kind === 'fees') out.push({ ...i, job: pay ? 'pay' : undefined })
    else if (i.kind === 'rsvps') {
      if (rsvp && rsvp.count > 0) {
        out.push({ ...i, job: 'rsvp', count: rsvp.count, title: `${rsvp.count} to answer`, detail: rsvp.detail, href: rsvp.href })
        placedRsvp = true
      }
    } else out.push(i)
  }
  if (!placedRsvp && rsvp && rsvp.count > 0) {
    out.push({ kind: 'rsvps', title: `${rsvp.count} to answer`, detail: rsvp.detail, href: rsvp.href, count: rsvp.count, urgent: false, job: 'rsvp' })
  }
  // Team chat is one of the three jobs (product direction: two taps from
  // Home), so it is always a row; the pill appears only while something is
  // unread.
  if (chat) {
    out.push({ kind: 'chat', title: 'Team chat', detail: chat.detail, href: chat.href, count: chat.count, urgent: false, job: 'chat' })
  }
  return out
}
