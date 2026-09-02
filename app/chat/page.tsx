import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChannelList } from './channel-list'
import { AppShellPage } from '@/components/shell-page'

export default async function ChatPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: channels } = await supabase.rpc('my_channels', { p_academy: academy.id })

  const rows = channels ?? []
  const unread = rows.reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0)
  const active = rows.filter((c) => c.status === 'active').length

  return (
    <AppShellPage
      title="Chats"
      meta={`${active} ${active === 1 ? 'channel' : 'channels'}${unread ? ` · ${unread} unread` : ''}`}
      academyId={academy.id}
      unread={unread}
    >
      <ChannelList channels={rows} />
    </AppShellPage>
  )
}
