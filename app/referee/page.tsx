import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { RefereeScreen } from './referee-screen'

/**
 * The referee's own page: the games they have been asked to take, the
 * ones they said yes to, check-in at the ground, the report afterwards,
 * and the dates they are not free. Thin: my_appointments is scoped to
 * the signed-in person, so there is nothing to pass down.
 */
export default async function RefereePage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin?next=/referee')
  return (
    <AppShellPage title="Refereeing" meta="Your games, your availability" back="/settings">
      <RefereeScreen />
    </AppShellPage>
  )
}
