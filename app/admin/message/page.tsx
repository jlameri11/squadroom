import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { MessageClub } from './message-club'

/**
 * Admin → Message the club (Big Club Mode item 4; 0243). Thin: the screen
 * resolves the organisation and asks the database who it may message and
 * how many that reaches; the send is one function that refuses the rest.
 */
export default async function MessageClubPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Message the club" back="/admin">
      <MessageClub />
    </AppShellPage>
  )
}
