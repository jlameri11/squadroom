import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { RolesScreen } from './roles-screen'

/**
 * Admin → People → Roles (Big Club Mode, 0236). Thin: the screen resolves
 * the organisation the browser is showing and draws from club_officials;
 * every grant and revoke is a function that refuses anyone but the club's
 * owners, admins, President or Secretary.
 */
export default async function RolesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Roles" back="/admin">
      <RolesScreen />
    </AppShellPage>
  )
}
