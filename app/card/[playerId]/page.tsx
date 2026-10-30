import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'
import { PlayerCard } from './player-card'

/**
 * A child's player card — the thing a referee or an opposition manager
 * checks at the ground. Thin: player_card (0146) decides who may see it,
 * and the photo is a short signed link minted for that person only.
 */
export default async function CardPage(props: { params: Promise<{ playerId: string }> }) {
  const userId = await getUserId()
  const { playerId } = await props.params
  if (!userId) redirect(`/signin?next=/card/${playerId}`)
  return (
    <AppShellPage title="Player card" back="/settings/family">
      <PlayerCard playerId={playerId} />
    </AppShellPage>
  )
}
