'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useScreen } from '@/lib/hooks/use-screen'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'
import { ChannelView, type GroupInfo, type NoticesInfo } from './channel-view'
import { ChatSkeleton } from './chat-skeleton'

/** What `channel_screen` (0273) answers: the page's props in one call. */
export type ChannelScreen = {
  denied?: boolean
  missing?: boolean
  channel?: {
    id: string
    academy_id: string
    team_id: string | null
    name: string | null
    type: string
    posting_mode: string
    archived: boolean
    restrictions: Record<string, boolean>
    competition_id: string | null
  }
  membership?: { role: string; muted: boolean } | null
  is_host?: boolean
  notices?: NoticesInfo | null
  group?: GroupInfo | null
  /** Newest first, as the function pages. */
  messages?: ChatMessage[]
}

/**
 * A chat, loaded from the browser (the "Feels instant" pass; 0273).
 *
 * The server used to render this whole page in us-east-2, three or four
 * trips to Sydney before the first bubble. Now the page is a shell and this
 * asks the database — a few milliseconds away from the people using it —
 * for the screen in one call, through the same cache as Home, the Chat list
 * and Fixtures: a chat opened before paints at once from memory or disk and
 * refreshes quietly; a new one shows its own skeleton, never Home's.
 */
export function ChannelLoader({ channelId, myId }: { channelId: string; myId: string }) {
  const { data, failed } = useScreen<ChannelScreen>('channel_screen', { p_channel: channelId })
  // Oldest first on screen. Memoised on the array itself, so the messages
  // hook re-seeds only when a fresh answer lands, not on every render.
  const initial = useMemo(() => (data?.messages ?? []).slice().reverse(), [data?.messages])

  if (!data) {
    if (failed) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-ink-2">Couldn&apos;t load this chat. Check your signal and try again.</p>
          <Link href="/chat" className="text-sm font-semibold underline underline-offset-4">Back to chats</Link>
        </main>
      )
    }
    return <ChatSkeleton />
  }
  if (data.denied || data.missing || !data.channel) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-semibold">{data.missing ? 'No such chat' : 'Not one of your chats'}</h1>
        <p className="text-sm text-ink-2">{data.missing ? 'It may have been removed.' : 'Only its members can open it.'}</p>
        <Link href="/chat" className="text-sm font-semibold underline underline-offset-4">Back to chats</Link>
      </main>
    )
  }
  const c = data.channel
  return (
    <ChannelView
      channelId={c.id}
      academyId={c.academy_id}
      teamId={c.team_id}
      name={c.name ?? 'Direct message'}
      postingMode={c.posting_mode}
      archived={c.archived}
      isHost={data.is_host === true}
      muted={data.membership?.muted ?? false}
      restrictions={c.restrictions ?? {}}
      myId={myId}
      initialMessages={initial}
      notices={data.notices ?? null}
      group={data.group ?? null}
    />
  )
}
