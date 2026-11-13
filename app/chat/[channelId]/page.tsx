import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/supabase/server'
import { ChannelLoader } from './channel-loader'

/**
 * /chat/<id> — a thin page (the "Feels instant" pass; 0273).
 *
 * It used to read the channel, the membership, the first fifty messages and
 * the hosting rule here, on a Netlify function in us-east-2, three or four
 * trips to Sydney before anything could paint. Now it only checks for a
 * session (getClaims answers that locally) and hands over the shell; the
 * browser asks Sydney for the screen in one call and keeps it cached.
 *
 * params is a Promise in Next 16.
 */
export default async function ChannelPage(props: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await props.params
  const userId = await getUserId()
  if (!userId) redirect('/signin')
  return <ChannelLoader channelId={channelId} myId={userId} />
}
