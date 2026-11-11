'use client'

import { useEffect, useState } from 'react'
import { WhenOn } from '@/components/when-on'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { AppShellPage } from '@/components/shell-page'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Counts = { pending: number; pendingRegistrations: number; pendingSignups: number }

/**
 * Whether this person has two-step sign-in on (S-07): the club's admins are
 * asked to. Asked again whenever the auth state changes — the wall (0231)
 * enrols a factor over this very screen, and the card must not go on asking.
 */
/**
 * Whether this organisation requires two-step sign-in of its owners and
 * admins (0231/0232). Null until known. Where it does, the wall has already
 * had them pass; where it does not — the clubs from before the rule — the
 * owner is reminded that it is theirs to turn on. Nobody is told to get an
 * authenticator app (Joey, 9 Nov 2026: optional, never required).
 */
function useTwoStepRequired(orgId: string | null | undefined) {
  const [required, setRequired] = useState<boolean | null>(null)
  useEffect(() => {
    if (!orgId) return
    let live = true
    ;(async () => {
      const { data } = await createClient().from('academies').select('two_step_required').eq('id', orgId).maybeSingle()
      if (live) setRequired(typeof (data as { two_step_required?: boolean } | null)?.two_step_required === 'boolean' ? Boolean((data as { two_step_required?: boolean }).two_step_required) : null)
    })()
    return () => {
      live = false
    }
  }, [orgId])
  return required
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
  const twoStepRequired = useTwoStepRequired(org?.id)

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
      <AppShellPage title="Admin" meta={org.name} isStaff={false}>
        <p className="card m-4 p-6 text-center text-sm text-ink-2" data-org={org.id}>
          This is for coaches and club admins. Nothing for you here.
        </p>
      </AppShellPage>
    )
  }

  const { pending, pendingRegistrations, pendingSignups } = counts ?? { pending: 0, pendingRegistrations: 0, pendingSignups: 0 }

  return (
    <AppShellPage title="Admin" meta={`Running ${org.name}`} isStaff>
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

        {/* S-07 (0231/0232): a club from before the rule does not yet ask its
            owners and admins for a code. Its owner is reminded, once per
            visit, that the switch is theirs — one way, in Club settings. */}
        {org.role === 'owner' && twoStepRequired === false && (
          <Link href="/settings/academy" className="card mb-4 flex items-center gap-3 p-3.5 text-sm" style={{ borderColor: 'var(--brand)' }} data-two-step-nag>
            <span className="min-w-0 flex-1">
              <b className="block">Two-step sign-in is off for {org.name}</b>
              <span className="block text-xs text-ink-3">Owners and admins reach every family&apos;s details. Require a six-digit code by text when they sign in — trusted devices are asked once in 30 days.</span>
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

        {/* Big Club Mode item 4 (0243): write once, pick who, see the reach, send. */}
        <h2 className="eyebrow px-1 pb-2">Messages</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/admin/message" label="Message the club" hint="Whole club, a stream, an age group, a team, staff, the unpaid — with the reach shown before you send" />
          <Row href="/messages" label="Club messages" hint="What the club has sent you" />
        </ul>

        <h2 className="eyebrow px-1 pb-2">Competitions</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/competitions" label="Competitions" hint="Tournaments, cups and gala days" />
          {/* Joey, 9 Nov 2026: an academy organises its own tournament or league;
              the competition is made under the academy, which then gets the
              organiser's tools for that competition only (as before). */}
          {isStaff && <Row href="/competitions/new" label="Organise a tournament or league" />}
        </ul>

        {isStaff && (
          <>
            <h2 className="eyebrow px-1 pb-2">The club</h2>
            <ul className="card mb-5 overflow-hidden">
              {/* Big Club Mode item 5/12 (0247): the club's health in one
                  card — switchable, for a small academy that does not need it. */}
              <WhenOn feature="club_health"><Row href="/admin/health" label="Club health" hint="Families joined per squad, squads with nobody in front of them, checks running out, PlayFootball not done" /></WhenOn>
              {/* Big Club Mode item 9 (0251): the club's Saturday in one place. */}
              <WhenOn feature="game_day"><Row href="/admin/saturday" label="Game day" hint="Every game today by ground: called off, live, results, squads short, nobody in charge" /></WhenOn>
              <Row href="/admin/payments" label="Collect payments" hint="Fees and entries" />
              <Row href="/admin/members" label="Members" hint="And who invited whom" />
              {/* Big Club Mode (0236): several roles per person, each with a
                  scope, and the log of who changed what. */}
              <Row href="/admin/roles" label="Roles" hint="President, Registrar, Treasurer, coordinators, team managers, Welfare officer" />
              <Row href="/admin/activity" label="Activity" hint="Who changed what, and when" />
              <Row href="/admin/invites" label="Invites" />
              <Row href="/admin/safeguarding" label="Welfare reports" hint="Messages and concerns families have reported — for the Welfare officer and the President" />
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
              <WhenOn feature="kit"><Row href="/admin/kit" label="Kit list" hint="What to order, and who has not been asked" /></WhenOn>
              <WhenOn feature="sponsors"><Row href="/admin/sponsors" label="Sponsors" hint="Your sponsors on the match centre and the share cards; Squadroom takes nothing" /></WhenOn>
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
