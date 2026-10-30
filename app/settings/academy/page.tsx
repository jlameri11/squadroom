import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { AcademyLoader } from './academy-loader'

/**
 * Club settings. Thin: the organisation is resolved in the browser
 * (academy-loader), because a server page cannot know which of a person's
 * organisations they have switched to, and "the first by name" picked the
 * wrong one for an owner of three.
 */
export default async function AcademySettingsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Club settings" back="/admin">
      <AcademyLoader />
    </AppShellPage>
  )
}
