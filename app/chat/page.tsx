import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChannelList } from './channel-list'
import { AppShellPage } from '@/components/shell-page'

/** One round trip. See 0068 — the academy lookup used to be a second one. */
export default async function ChatPage() {
  const supabase = await createClient()
  const { data } = await supabase.rpc('chat_screen')

  const screen = data as unknown as {
    academy: { id: string; name: string } | null
    is_staff: boolean
    channels: Parameters<typeof ChannelList>[0]['channels']
  } | null

  if (!screen) redirect('/signin')
  if (!screen.academy) redirect('/start')

  const rows = screen.channels ?? []
  const unread = rows.reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0)
  const active = rows.filter((c) => c.status === 'active').length

  return (
    <AppShellPage
      title="Chats"
      meta={`${active} ${active === 1 ? 'channel' : 'channels'}${unread ? ` · ${unread} unread` : ''}`}
      isStaff={screen.is_staff}
      unread={unread}
    >
      <ChannelList channels={rows} />
    </AppShellPage>
  )
}
