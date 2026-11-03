import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { SponsorsScreen } from './sponsors-screen'

/** Admin → Sponsors (X-08). Thin: the screen reads and writes academy_sponsors under RLS. */
export default async function SponsorsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Sponsors" back="/admin">
      <SponsorsScreen />
    </AppShellPage>
  )
}
