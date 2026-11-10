import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { HealthScreen } from './health-screen'

/**
 * Admin → Club health (Big Club Mode items 5 and 12; 0247). Families joined
 * per squad, squads with nobody in front of them, checks running out,
 * PlayFootball not done, and how far setup has got — one card, each line a
 * tap from the screen that fixes it. Switchable (Settings → Features).
 */
export default async function HealthPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Club health" back="/admin">
      <HealthScreen />
    </AppShellPage>
  )
}
