'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { AppShellPage } from '@/components/shell-page'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Counts = { pending: number; pendingRegistrations: number; pendingSignups: number }

/** Whether this person has two-step sign-in on (S-07): the club's admins are asked to. */
function useTwoStep() {
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().auth.mfa.listFactors()
      if (live) setOn(Boolean(data?.totp?.some((f) => f.status === 'verified')))
    })()
    return () => {
      live = false
    }
  }, [])
  return on
}

/**
 * Where running the club lives.
 *
 * These were all listed on the home screen, which made it long and made a
 * parent scroll past four things they cannot use. A coach comes to the Admin
 * tab when running the club is what they came to do.
 *
 * Which club: the one the browser is showing (lib/use-current-org). The
 * page used to take the first by name on the server, which for an owner of
 * several was the wrong one, and every link below then led into it.
 */
export function AdminHub() {
  const org = useCurrentOrg()
  const [counts, setCounts] = useState<Counts | null>(null)
  const twoStep = useTwoStep()

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      const [{ count: pending }, { count: pendingRegistrations }, { count: pendingSignups }] = await Promise.all([
        supabase.from('join_requests').select('id', { count: 'exact', head: true }).eq('academy_id', org.id).eq('status', 'pending'),
        supabase.from('program_registrations').select('id', { count: 'exact', head: true }).eq('academy_id', org.id).eq('status', 'pending'),
        // Families who used the public register link. A third queue, and the
        // only one containing people the club has never met.
        supabase.from('registration_requests').select('id', { count: 'exact', head: true }).eq('academy_id', org.id).eq('status', 'pending'),
      ])
      if (live) setCounts({ pending: pending ?? 0, pendingRegistrations: pendingRegistrations ?? 0, pendingSignups: pendingSignups ?? 0 })
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org) return <ScreenSkeleton />

  const isCoach = org.role === 'owner' || org.role === 'admin' || org.role === 'coach'
  const isStaff = org.role === 'owner' || org.role === 'admin'

  // A parent who lands here should be told, not shown an empty screen.
  if (!isCoach) {
    return (
      <AppShellPage title="Admin" meta={org.name} isStaff={false} brand={org.primary_colour}>
        <p className="card m-4 p-6 text-center text-sm text-ink-2" data-org={org.id}>
          This is for coaches and club admins. Nothing for you here.
        </p>
      </AppShellPage>
    )
  }

  const { pending, pendingRegistrations, pendingSignups } = counts ?? { pending: 0, pendingRegistrations: 0, pendingSignups: 0 }

  return (
    <AppShellPage title="Admin" meta={`Running ${org.name}`} isStaff brand={org.primary_colour}>
      <div className="p-3.5" data-org={org.id}>
        {pending ? (
          <Link
            href="/admin/requests"
            className="mb-4 flex items-center gap-3 rounded-[14px] p-3.5 text-sm"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--shadow)' }}
          >
            <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-white/25 text-base">
              {pending}
            </span>
            <span>
              <b>{pending === 1 ? 'A family is' : `${pending} families are`} waiting</b>
              <span className="block opacity-90">They see nothing until you approve them.</span>
            </span>
          </Link>
        ) : null}

        {/* Two queues, two prompts. One combined "5 things waiting" would
            make a coach open Admin to find out which, which is the trip this
            is here to save. */}
        {pendingRegistrations ? (
          <Link
            href="/admin/programs"
            className="mb-4 flex items-center gap-3 rounded-[14px] p-3.5 text-sm"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--shadow)' }}
          >
            <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-white/25 text-base">
              {pendingRegistrations}
            </span>
            <span>
              <b>
                {pendingRegistrations === 1 ? 'A registration is' : `${pendingRegistrations} registrations are`} waiting
              </b>
              <span className="block opacity-90">Families see &ldquo;pending&rdquo; until somebody decides.</span>
            </span>
          </Link>
        ) : null}

        {/* S-07: the people who run a club are asked for two-step sign-in.
            A card until the database can insist (the migration half). */}
        {isStaff && twoStep === false && (
          <Link href="/settings#two-step" className="card mb-4 flex items-center gap-3 p-3.5 text-sm" style={{ borderColor: 'var(--brand)' }} data-two-step-nag>
            <span className="min-w-0 flex-1">
              <b className="block">Turn on two-step sign-in</b>
              <span className="block text-xs text-ink-3">Your account reaches every family&apos;s details. A six-digit code from an authenticator app keeps a stolen password out.</span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        )}

        {/* A coach who is not staff sees only what the database lets them
            do: their squads, the families waiting on them, the programs they
            decide registrations for, and a file to import for their squad.
            Rolling the season over, laying out grounds and starting a
            competition are the club's, and a row that ends in "only an
            admin can…" is a row that should not be there (Joey, 4 Nov 2026). */}
        <h2 className="eyebrow px-1 pb-2">{isStaff ? 'The team' : 'Your squads'}</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/admin/teams" label="Teams and players" hint="Squads, seasons, join links" />
          {isStaff && <Row href="/admin/season" label="New season" hint="Roll every squad up an age group, then chase re-registrations" />}
          {isStaff && <Row href="/admin/venues" label="Venues and pitches" hint="Grounds, the pitch layout, hours, and which size each age group plays on" />}
          <Row href="/admin/requests" label="Join requests" hint="Approve new families" />
          <Row
            href="/admin/programs"
            label="Programs"
            hint={pendingRegistrations ? `${pendingRegistrations} waiting · squads, camps, trials, tours` : 'Squads, camps, trials, tours — and what they cost'}
          />
          {/* One row, not three.
              "Import a draw", "Import a roster" and "Scan a draw" were three
              rows for one intention — get what we already have into the app —
              and they made a coach pick a TECHNIQUE before knowing which one
              applied to the file in their hand. The import screen asks that
              question itself, where the answer is obvious. */}
          <Row href="/admin/import" label="Import fixtures or players" hint="A Dribl export, a spreadsheet, or a screenshot" />
        </ul>

        <h2 className="eyebrow px-1 pb-2">Competitions</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/competitions" label="Competitions" hint="Tournaments, cups and gala days" />
          {isStaff && <Row href="/competitions/new" label="Start a competition" />}
        </ul>

        {isStaff && (
          <>
            <h2 className="eyebrow px-1 pb-2">The club</h2>
            <ul className="card mb-5 overflow-hidden">
              <Row href="/admin/payments" label="Collect payments" hint="Fees and entries" />
              <Row href="/admin/members" label="Members" hint="And who invited whom" />
              <Row href="/admin/invites" label="Invites" />
              <Row href="/admin/safeguarding" label="Safeguarding reports" hint="Messages families have reported" />
              {/* Linked from here deliberately. A compliance screen nothing
                  points at is a compliance screen nobody opens — /programs
                  and /payments were both built and reachable from nowhere. */}
              <Row href="/admin/clearances" label="Working With Children Checks" hint="Who is cleared, and who is running out" />
              {/* "Registrations" next to "Programs and registrations" was
                  two rows a club admin could not tell apart — and this is the
                  one with families waiting in it who have never met the club,
                  so it says so. */}
              <Row
                href="/admin/registrations"
                label="Sign-ups from your register link"
                hint={pendingSignups ? `${pendingSignups} waiting to hear from you` : 'Families who found you themselves'}
              />
              <Row href="/admin/kit" label="Kit list" hint="What to order, and who has not been asked" />
              <Row href="/admin/sponsors" label="Sponsors" hint="Your sponsors on the match centre and the share cards; Squadroom takes nothing" />
              <Row href="/settings/academy" label="Club settings" hint="Colours, privacy, safeguarding" />
            </ul>
          </>
        )}
      </div>
    </AppShellPage>
  )
}

function Row({ href, label, hint }: { href: string; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="row justify-between">
        <span className="min-w-0">
          <span className="block truncate font-medium">{label}</span>
          {hint && <span className="block truncate text-sm text-ink-3">{hint}</span>}
        </span>
        <span className="flex-none text-lg text-ink-3">›</span>
      </Link>
    </li>
  )
}
