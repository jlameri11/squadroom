import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ClubMessages } from '../club-messages'

/** A push opens the exact message (CLAUDE.md: never a home screen). */
export default async function MessagePage(props: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await props.params
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Club messages" back="/">
      <ClubMessages openId={messageId} />
    </AppShellPage>
  )
}
