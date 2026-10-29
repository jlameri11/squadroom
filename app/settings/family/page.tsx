import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { FamilyScreen } from './family-screen'

/**
 * Settings → My family.
 *
 * Every field behind this screen has existed for weeks — medical (0082),
 * kit sizes (0123), squad numbers (0085), consents (0084) — and every one
 * of them was admin- and coach-side only. A parent's single route to their
 * own child's record was the JSON data export. This is the other route.
 *
 * Thin: the screen fetches through `my_family`, which is scoped to the
 * children the caller is a guardian of, so there is nothing to pass down.
 */
export default async function FamilyPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="My family" meta="Only you and the club see these" back="/settings">
      <FamilyScreen />
    </AppShellPage>
  )
}
