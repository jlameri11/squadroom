import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { VenuesScreen } from './venues-screen'

/**
 * Admin → Venues and pitches (L-29). Thin: the screen resolves the
 * organisation the browser is showing (lib/org) and draws from
 * venue_layout; every change goes through a function that refuses anyone
 * but the club's staff.
 */
export default async function VenuesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Venues and pitches" back="/admin">
      <VenuesScreen />
    </AppShellPage>
  )
}
