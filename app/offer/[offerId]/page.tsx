import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { OfferScreen } from './offer-screen'

/**
 * An offer of a squad place, after trials. Thin: the screen reads
 * my_offers, which is scoped to the children this person guards, so an
 * offer id that is not theirs simply is not there.
 */
export default async function OfferPage(props: { params: Promise<{ offerId: string }> }) {
  const userId = await getUserId()
  const { offerId } = await props.params
  if (!userId) redirect(`/signin?next=/offer/${offerId}`)
  return (
    <AppShellPage title="A place in a squad" back="/programs">
      <OfferScreen offerId={offerId} />
    </AppShellPage>
  )
}
