import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { InvitesLoader } from './invites-loader'
import { AppShellPage } from '@/components/shell-page'

/**
 * Who has been invited, by whom, and whether they turned up.
 *
 * "Sent" here means a row exists — it does not mean anything was delivered.
 * Onboarding sends nothing by text; these are the fallback invites for
 * families who never tapped the group link, and the list says so. Thin:
 * the browser picks the organisation.
 */
export default async function InvitesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Invites" back="/admin">
      <InvitesLoader />
    </AppShellPage>
  )
}
