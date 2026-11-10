import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ClubMessages } from './club-messages'

/**
 * Club messages (Big Club Mode item 4; 0243): what the club has sent me —
 * pinned first, then newest; opening one marks it seen. Thin.
 */
export default async function MessagesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Club messages" back="/">
      <ClubMessages />
    </AppShellPage>
  )
}
