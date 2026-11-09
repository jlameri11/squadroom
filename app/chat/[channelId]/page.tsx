import { notFound, redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { ChannelView, type GroupInfo, type NoticesInfo } from './channel-view'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'

export default async function ChannelPage(props: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await props.params
  const supabase = await createClient()

  const userId = await getUserId()
  if (!userId) redirect('/signin')

  // `*`, not a column list: a competition's Notices add `competition_id`
  // (0213), and naming a column that is not there yet fails the whole read.
  const { data: channel } = await supabase
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .maybeSingle()

  if (!channel) notFound()

  const [{ data: membership }, { data: raw }] = await Promise.all([
    supabase
      .from('channel_members')
      .select('role, muted')
      .eq('channel_id', channelId)
      .eq('profile_id', userId)
      .maybeSingle(),
    supabase.rpc('channel_messages', { p_channel: channelId, p_limit: 50 }),
  ])

  // Newest-first from the database for paging; oldest-first on screen.
  const messages = ((raw ?? []) as ChatMessage[]).slice().reverse()

  // A competition's Notices (0213): the league posts; everyone else reads.
  // "May I post here" is the database's answer, because the league's
  // competition managers host them without being the organisation's staff.
  const competitionId = (channel as { competition_id?: string | null }).competition_id ?? null
  let notices: NoticesInfo | null = null
  let group: GroupInfo | null = null
  let isHost: boolean
  const kind = channel.type as string
  if (kind === 'clubs' || kind === 'referees') {
    // A computed room (0235): who is in it, and whether I host it (the
    // league does), are the database's answers — there are no member rows.
    const { data } = await supabase.rpc('group_channel_info', { p_channel: channelId })
    group = (data as unknown as GroupInfo | null) ?? null
    isHost = group?.is_host === true
  } else if (kind === 'notices' && competitionId) {
    const [{ data: canPost }, { data: comp }] = await Promise.all([
      supabase.rpc('can_post_in_channel', { p_channel: channelId }),
      supabase.from('competitions').select('name, organiser, organiser_id').eq('id', competitionId).maybeSingle(),
    ])
    // The organiser's own row is withheld from another club's people; the
    // competition carries the league's name for exactly this (0213 went live
    // and a club's coach read "From The league").
    const { data: league } = comp
      ? await supabase.from('academies').select('name').eq('id', comp.organiser_id).maybeSingle()
      : { data: null }
    isHost = canPost === true
    notices = { competitionId, competition: comp?.name ?? channel.name ?? 'This competition', league: league?.name ?? comp?.organiser ?? 'The league' }
  } else {
    // Academy staff host every channel, whether or not they hold a host row.
    const { data: academyRole } = await supabase
      .from('academy_members')
      .select('role')
      .eq('academy_id', channel.academy_id)
      .eq('profile_id', userId)
      .maybeSingle()

    isHost =
      membership?.role === 'host' ||
      membership?.role === 'co_host' ||
      academyRole?.role === 'owner' ||
      academyRole?.role === 'admin'
  }

  return (
    <ChannelView
      channelId={channel.id}
      academyId={channel.academy_id}
      teamId={channel.team_id}
      name={channel.name ?? 'Direct message'}
      postingMode={channel.posting_mode}
      archived={channel.status === 'archived'}
      isHost={isHost}
      muted={membership?.muted ?? false}
      restrictions={(channel.restrictions ?? {}) as Record<string, boolean>}
      myId={userId}
      initialMessages={messages}
      notices={notices}
      group={group}
    />
  )
}
