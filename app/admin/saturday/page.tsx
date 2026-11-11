import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { SaturdayScreen } from './saturday-screen'

/**
 * Admin → Game day (Big Club Mode item 9; 0251): every game today across
 * the club by ground — called off, live, finished, who is in charge, who has
 * said yes, referees and sheets for the club's own competitions. Switchable
 * (Settings → Features: Game day).
 */
export default async function SaturdayPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Game day" back="/admin">
      <SaturdayScreen />
    </AppShellPage>
  )
}
