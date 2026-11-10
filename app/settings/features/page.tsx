import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { FeaturesScreen } from './features-screen'

/**
 * Settings → Features (Joey, 10 Nov 2026; 0242): every feature that is not
 * core, with its one line and its switch. Thin: the screen resolves the
 * organisation and every flip is a function that refuses anyone but the
 * people who run it.
 */
export default async function FeaturesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Features" back="/settings/academy">
      <FeaturesScreen />
    </AppShellPage>
  )
}
