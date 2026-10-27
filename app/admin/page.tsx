import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import Link from 'next/link'

/**
 * Where running the club lives.
 *
 * These were all listed on the home screen, which made it long and made a
 * parent scroll past four things they cannot use. A coach comes to the Admin
 * tab when running the club is what they came to do.
 */
export default async function AdminHub() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const supabase = await createClient()
  const { data: academies } = await supabase
    .from('academies')
    .select('id, name, primary_colour')
    .order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: membership } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', academy.id)
    .eq('profile_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  const role = membership?.role ?? 'parent'
  const isCoach = role === 'owner' || role === 'admin' || role === 'coach'
  const isStaff = role === 'owner' || role === 'admin'

  // A parent who lands here should be told, not shown an empty screen.
  if (!isCoach) {
    return (
      <AppShellPage title="Admin" meta={academy.name} isStaff={false} brand={academy.primary_colour}>
        <p className="card m-4 p-6 text-center text-sm text-ink-2">
          This is for coaches and club admins. Nothing for you here.
        </p>
      </AppShellPage>
    )
  }

  const [{ count: pending }, { count: pendingRegistrations }] = await Promise.all([
    supabase
      .from('join_requests')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', academy.id)
      .eq('status', 'pending'),
    supabase
      .from('program_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('academy_id', academy.id)
      .eq('status', 'pending'),
  ])

  return (
    <AppShellPage
      title="Admin"
      meta={`Running ${academy.name}`}
      isStaff
      brand={academy.primary_colour}
    >
      <div className="p-3.5">
        {pending ? (
          <Link
            href="/admin/requests"
            className="mb-4 flex items-center gap-3 rounded-[14px] p-3.5 text-sm text-white"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}
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
            className="mb-4 flex items-center gap-3 rounded-[14px] p-3.5 text-sm text-white"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow)' }}
          >
            <span className="display grid h-8 w-8 flex-none place-items-center rounded-full bg-white/25 text-base">
              {pendingRegistrations}
            </span>
            <span>
              <b>
                {pendingRegistrations === 1
                  ? 'A registration is'
                  : `${pendingRegistrations} registrations are`}{' '}
                waiting
              </b>
              <span className="block opacity-90">
                Families see &ldquo;pending&rdquo; until somebody decides.
              </span>
            </span>
          </Link>
        ) : null}

        <h2 className="eyebrow px-1 pb-2">The team</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/admin/teams" label="Teams and players" hint="Squads, seasons, join links" />
          <Row href="/admin/requests" label="Join requests" hint="Approve new families" />
          <Row
            href="/admin/programs"
            label="Programs and registrations"
            hint={
              pendingRegistrations
                ? `${pendingRegistrations} waiting · squads, camps, trials, tours`
                : 'Squads, camps, trials, tours'
            }
          />
          <Row href="/admin/import" label="Import a draw" hint="From a Dribl export" />
          <Row href="/admin/import/players" label="Import a roster" hint="A spreadsheet of players" />
          <Row href="/scan" label="Scan a draw" hint="From a screenshot" />
        </ul>

        <h2 className="eyebrow px-1 pb-2">Competitions</h2>
        <ul className="card mb-5 overflow-hidden">
          <Row href="/competitions" label="Competitions" hint="Tournaments, cups and gala days" />
          <Row href="/competitions/new" label="Start a competition" />
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
              <Row
                href="/admin/clearances"
                label="Working With Children Checks"
                hint="Who is cleared, and who is running out"
              />
              <Row
                href="/admin/registrations"
                label="Registrations"
                hint="Families who signed up through your public link"
              />
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
