import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SetPassword } from './set-password'
import { SignOut } from '@/components/sign-out'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'
import { PushToggle } from './push-toggle'
import { CalendarFeed } from './calendar-feed'
import { MyData } from './my-data'
import { AppShellPage } from '@/components/shell-page'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (!userId) redirect('/signin')
  const email = (claims?.claims?.email as string | undefined) ?? null

  // Your own number is only readable through this function: 0012 revoked the
  // column from the table grant so nobody can read anyone else's.
  const { data } = await supabase.rpc('my_profile')
  const me = data?.[0]

  return (
    <AppShellPage title="Your details" meta="Only you see these">
      <div className="p-4">
      <p className="mt-1 text-sm text-ink-2">
        Your name is what people see on your messages.
      </p>
      <ProfileForm
        initialName={me?.full_name ?? ''}
        initialPhone={me?.phone ?? ''}
        email={email}
      />
      {/*
        A permanent way to reach these two.

        The "Needs you" strip on the home screen gets a parent to their bills
        and to anything open to sign up to — but only while something is
        outstanding. A family who has paid everything could not find their
        payment history at all, which is the same discoverability hole in a
        quieter form. These are always here.
      */}
      <ul className="card mt-6 overflow-hidden">
        <li>
          <Link href="/payments" className="row justify-between">
            <span className="min-w-0">
              <span className="block truncate font-medium">Your payments</span>
              <span className="block truncate text-sm text-ink-3">
                Fees, what&apos;s paid and what&apos;s left
              </span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        </li>
        <li>
          <Link href="/programs" className="row justify-between">
            <span className="min-w-0">
              <span className="block truncate font-medium">Sign up to something</span>
              <span className="block truncate text-sm text-ink-3">
                Camps, trials, squads and tours
              </span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        </li>
      </ul>

      {/* Before push and the calendar feed, because somebody who has just
          arrived by emailed link has no way back in until they do this. */}
      <SetPassword />

      <PushToggle />
      <CalendarFeed />
      <MyData />

      {/* The proper home for it, as well as the home screen's footer — this
          is where somebody looks for it. */}
      <section className="mt-8 border-t pt-4" style={{ borderColor: 'var(--line-2)' }}>
        <SignOut variant="button" />
      </section>
    </div>
    </AppShellPage>
  )
}
