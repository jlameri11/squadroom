import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { MembersLoader } from './members-loader'
import { AppShellPage } from '@/components/shell-page'

/**
 * Who is in the academy, and who let them in.
 *
 * The tree is the reason invited_by is recorded at all: an owner can see that
 * a coach brought fourteen families, and remove all fifteen in one action if
 * that coach leaves under a cloud. Thin: the browser picks the organisation.
 */
export default async function MembersPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Members" back="/admin">
      <MembersLoader />
    </AppShellPage>
  )
}
