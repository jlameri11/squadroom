import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChannelView } from './channel-view'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'

export default async function ChannelPage(props: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await props.params
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: channel } = await supabase
    .from('channels')
    .select('id, academy_id, name, type, posting_mode, status, restrictions')
    .eq('id', channelId)
    .maybeSingle()

  if (!channel) notFound()

  const [{ data: membership }, { data: raw }] = await Promise.all([
    supabase
      .from('channel_members')
      .select('role, muted')
      .eq('channel_id', channelId)
      .eq('profile_id', auth.user.id)
      .maybeSingle(),
    supabase.rpc('channel_messages', { p_channel: channelId, p_limit: 50 }),
  ])

  // Newest-first from the database for paging; oldest-first on screen.
  const messages = ((raw ?? []) as ChatMessage[]).slice().reverse()

  // Academy staff host every channel, whether or not they hold a host row.
  const { data: academyRole } = await supabase
    .from('academy_members')
    .select('role')
    .eq('academy_id', channel.academy_id)
    .eq('profile_id', auth.user.id)
    .maybeSingle()

  const isHost =
    membership?.role === 'host' ||
    membership?.role === 'co_host' ||
    academyRole?.role === 'owner' ||
    academyRole?.role === 'admin'

  return (
    <ChannelView
      channelId={channel.id}
      academyId={channel.academy_id}
      name={channel.name ?? 'Direct message'}
      postingMode={channel.posting_mode}
      archived={channel.status === 'archived'}
      isHost={isHost}
      muted={membership?.muted ?? false}
      myId={auth.user.id}
      initialMessages={messages}
    />
  )
}
