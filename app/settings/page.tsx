import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'
import { PushToggle } from './push-toggle'
import { CalendarFeed } from './calendar-feed'
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
      <PushToggle />
      <CalendarFeed />
    </div>
    </AppShellPage>
  )
}
