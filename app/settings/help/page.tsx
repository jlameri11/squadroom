import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { HelpScreen } from './help-screen'

/** Settings → Help (G-03). Thin: the screen talks to support_threads and friends. */
export default async function HelpPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin?next=/settings/help')
  return (
    <AppShellPage title="Help and support" back="/settings">
      <HelpScreen />
    </AppShellPage>
  )
}
