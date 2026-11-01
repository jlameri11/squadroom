import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { CheckinScreen } from './checkin-screen'

/** W-06: where the QR lands. Signed out, through sign-in and back here. */
export default async function RefereeCheckinPage(props: { searchParams: Promise<{ f?: string; k?: string }> }) {
  const { f, k } = await props.searchParams
  const userId = await getUserId()
  if (!userId) redirect(`/signin?next=${encodeURIComponent(`/referee/checkin?f=${f ?? ''}&k=${k ?? ''}`)}`)
  return (
    <AppShellPage title="Check in" back="/referee">
      <CheckinScreen fixtureId={f ?? ''} keyValue={k ?? ''} />
    </AppShellPage>
  )
}
