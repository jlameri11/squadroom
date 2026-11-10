import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ActivityScreen } from './activity-screen'

/**
 * Admin → Activity (Big Club Mode item 13; 0236). Who changed what, when:
 * roles, members, teams, streams, fees, payments, refunds, call-offs. For
 * the people who run the club; it survives the committee changing.
 */
export default async function ActivityPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Activity" back="/admin">
      <ActivityScreen />
    </AppShellPage>
  )
}
