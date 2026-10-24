'use client'

import { ChannelList } from './channel-list'
import { NewChat } from './new-chat'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { useScreen } from '@/lib/hooks/use-screen'
import { useOrg } from '@/lib/org'

type Data = {
  academy: { id: string; name: string } | null
  is_staff: boolean
  channels: Parameters<typeof ChannelList>[0]['channels']
}

export function ChatScreen() {
  const org = useOrg()
  const { data, failed } = useScreen<Data>('chat_screen', { p_academy: org })

  if (failed || (data && !data.academy)) {
    if (typeof window !== 'undefined' && data && !data.academy) window.location.replace('/start')
    return (
      <div className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">Couldn&apos;t load your chats.</p>
      </div>
    )
  }
  if (!data) return <ScreenSkeleton />

  const rows = data.channels ?? []
  const unread = rows.reduce((n, c) => n + (c.muted ? 0 : c.unread_count), 0)
  const active = rows.filter((c) => c.status === 'active').length

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Chats"
        meta={`${active} ${active === 1 ? 'channel' : 'channels'}${unread ? ` · ${unread} unread` : ''}`}
        action={<NewChat academyId={data.academy!.id} canCreate={data.is_staff} />}
      />
      <Screen>
        <ChannelList channels={rows} />
      </Screen>
    </div>
  )
}
