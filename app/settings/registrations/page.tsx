import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { RegistrationsScreen } from './registrations-screen'

/**
 * Settings → My registrations (the registration brief, gap 4; 0265).
 *
 * Every registration a family has made and where it stands, their people
 * to sign up again or edit, and their payments with a receipt each. Thin:
 * the screen reads `my_registrations`, which is scoped to the caller.
 */
export default async function MyRegistrationsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="My registrations" meta="Where each one stands, your people, your receipts" back="/settings">
      <RegistrationsScreen />
    </AppShellPage>
  )
}
