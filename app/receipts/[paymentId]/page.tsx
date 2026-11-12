import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { ReceiptScreen } from './receipt-screen'

/**
 * A payment's receipt (the registration brief, gaps 4 and 9; 0265). Thin:
 * the screen reads `payment_receipt`, which answers only the payer, the
 * child's family and the club.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return (
    <AppShellPage title="Receipt" meta="Paid to the club through Stripe" back="/settings/registrations">
      <ReceiptScreen paymentId={paymentId} />
    </AppShellPage>
  )
}
