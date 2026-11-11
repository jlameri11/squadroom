import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { RostersScreen } from './rosters-screen'

/**
 * Admin → Rosters (Big Club Mode item 10; 0252): each ground's day and its
 * spots, the game days with no day set up, the games whose duties are short
 * or asked to be swapped. For the staff and the Volunteer coordinator.
 */
export default async function RostersPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Rosters" back="/admin">
      <RostersScreen />
    </AppShellPage>
  )
}
