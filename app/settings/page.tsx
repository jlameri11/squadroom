import { redirect } from 'next/navigation'
import { WhenOn } from '@/components/when-on'
import Link from 'next/link'
import { SetPassword } from './set-password'
import { SignOut } from '@/components/sign-out'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'
import { PushToggle } from './push-toggle'
import { CalendarFeed } from './calendar-feed'
import { TwoStep } from './two-step'
import { WelfareContact } from '@/components/welfare-contact'
import { RequestARole } from './role-request'
import { MyData } from './my-data'
import { ChatLanguage } from './chat-language'
import { NotificationPrefs } from './notification-prefs'
import { AppearanceSettings } from './appearance'
import { YourEmail } from './your-email'
import { Suspense } from 'react'
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
  // L-06: only a referee sees the Refereeing row — a parent has no use for
  // it, and the pool row is visible to its own person and nobody else.
  const { count: pools } = await supabase.from('referees').select('id', { count: 'exact', head: true }).eq('profile_id', userId)
  const isReferee = (pools ?? 0) > 0
  // W-08: the language this person reads messages in (null = as written).
  const { data: langRow } = await supabase.from('profiles').select('chat_language').eq('id', userId).maybeSingle()
  const { data: digest } = await supabase.rpc('my_digest_minutes')

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
      {/* 0214: every account has an email. Hidden until the migration lands. */}
      <Suspense fallback={null}>
        <YourEmail />
      </Suspense>
      <ChatLanguage initial={langRow?.chat_language ?? null} />
      <WhenOn feature="digest"><NotificationPrefs initialDigest={(digest as number | null) ?? 0} /></WhenOn>
      <AppearanceSettings />
      {/*
        A permanent way to reach these two.

        The "Needs you" strip on the home screen gets a parent to their bills
        and to anything open to sign up to — but only while something is
        outstanding. A family who has paid everything could not find their
        payment history at all, which is the same discoverability hole in a
        quieter form. These are always here.
      */}
      <ul className="card mt-6 overflow-hidden">
        {isReferee && (
          <li>
            <Link href="/referee" className="row justify-between">
              <span className="min-w-0">
                <span className="block truncate font-medium">Refereeing</span>
                <span className="block truncate text-sm text-ink-3">
                  Your games, check-in, reports, dates you can&apos;t do
                </span>
              </span>
              <span className="flex-none text-lg text-ink-3">›</span>
            </Link>
          </li>
        )}
        <li>
          <Link href="/settings/help" className="row justify-between">
            <span className="min-w-0">
              <span className="block truncate font-medium">Help and support</span>
              <span className="block truncate text-sm text-ink-3">
                Ask Squadroom — a person replies, and you get a push
              </span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        </li>
        <li>
          <Link href="/settings/report" className="row justify-between">
            <span className="min-w-0">
              <span className="block truncate font-medium">Report a concern</span>
              <span className="block truncate text-sm text-ink-3">
                About an adult&apos;s conduct — seen only by the Welfare officer and the President
              </span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        </li>
        <li>
          <Link href="/settings/family" className="row justify-between">
            <span className="min-w-0">
              <span className="block truncate font-medium">My family</span>
              <span className="block truncate text-sm text-ink-3">
                Your children: medical, emergency contacts, agreements, kit sizes
              </span>
            </span>
            <span className="flex-none text-lg text-ink-3">›</span>
          </Link>
        </li>
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
      {/* Part A fix 4 (0241): the club's Welfare officer, and one tap to message them. */}
      <WelfareContact />

      {/* 0256: ask to coach, manage, volunteer, referee or sit on the committee. */}
      <WhenOn feature="role_requests"><RequestARole /></WhenOn>

      <SetPassword />
      {/* S-07. Next to the password, because it is the other half of it. */}
      <TwoStep />

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
