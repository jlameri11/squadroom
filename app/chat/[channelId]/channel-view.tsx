'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useChannelMessages, type ChatMessage } from '@/lib/hooks/use-channel-messages'
import { MessageBubble } from './message-bubble'
import { Composer } from './composer'
import { PendingQueue } from './pending-queue'
import { ChannelSettings } from './channel-settings'

export function ChannelView({
  channelId, academyId, teamId, name, postingMode, archived, isHost, muted, restrictions, myId, initialMessages,
}: {
  channelId: string
  academyId: string
  teamId: string | null
  name: string
  postingMode: string
  archived: boolean
  isHost: boolean
  muted: boolean
  restrictions: Record<string, boolean>
  myId: string
  initialMessages: ChatMessage[]
}) {
  const { messages, loadOlder, hasMore, loadingOlder, addOptimistic, replaceOptimistic } =
    useChannelMessages(channelId, initialMessages)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const supabase = useRef(createClient())

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  // Opening the channel is what clears the badge, not reading any particular
  // message. Anything cleverer than this lies about what people actually do.
  useEffect(() => {
    supabase.current.rpc('mark_channel_read', { p_channel: channelId })
  }, [channelId])

  const pinned = useMemo(
    () => messages.filter((m) => m.pinned_at && !m.deleted_at).slice(-1)[0] ?? null,
    [messages]
  )

  const canPost = !archived && (isHost || postingMode === 'open' || postingMode === 'replies_only')

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col">
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3.5 pt-3"
        style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
      >
        <Link
          href="/chat"
          aria-label="Back to chats"
          className="-ml-1 grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
          style={{ background: '#ffffff26' }}
        >
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="display truncate text-[21px] leading-tight">{name}</h1>
          <p className="truncate text-xs opacity-75">
            {archived ? 'Past season · read-only'
              : postingMode === 'hosts_only' ? 'Announcements only'
              : postingMode === 'replies_only' ? 'Replies only'
              : 'Everyone can post'}
            {muted && ' · muted'}
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-lg"
          style={{ background: '#ffffff26' }}
          aria-label="Channel settings"
        >
          ⋯
        </button>
      </header>

      {showSettings && (
        <ChannelSettings
          channelId={channelId}
          name={name}
          postingMode={postingMode}
          restrictions={restrictions}
          muted={muted}
          isHost={isHost}
          onClose={() => setShowSettings(false)}
        />
      )}

      <PendingQueue channelId={channelId} isHost={isHost} />

      {pinned && (
        <div
          className="flex items-start gap-2.5 border-b px-4 py-2.5"
          style={{ background: 'var(--maybe-bg)', borderColor: 'var(--line)' }}
        >
          <span className="mt-0.5 flex-none text-sm" aria-hidden>📌</span>
          <span className="min-w-0">
            <span className="eyebrow block" style={{ color: 'var(--maybe)' }}>Pinned</span>
            <span className="block truncate text-sm text-ink">{pinned.body}</span>
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: 'var(--paper)' }}>
        {hasMore && (
          <button
            onClick={loadOlder}
            disabled={loadingOlder}
            className="mx-auto mb-3 block rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs text-ink-2"
          >
            {loadingOlder ? 'Loading…' : 'Earlier messages'}
          </button>
        )}

        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-2">
            Nothing here yet. Say hello.
          </p>
        )}

        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.sender_id === myId}
            isHost={isHost}
            academyId={academyId}
            myId={myId}
            showDay={showDaySeparator(messages, i)}
            onReply={() => setReplyTo(m)}
          />
        ))}
        <div ref={bottom} />
      </div>

      <Composer
        channelId={channelId}
        academyId={academyId}
        teamId={teamId}
        myId={myId}
        canPost={canPost}
        isHost={isHost}
        archived={archived}
        postingMode={postingMode}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        lastMessageId={messages[messages.length - 1]?.id ?? null}
        addOptimistic={addOptimistic}
        replaceOptimistic={replaceOptimistic}
      />
    </div>
  )
}

function showDaySeparator(messages: ChatMessage[], i: number) {
  if (i === 0) return true
  const prev = new Date(messages[i - 1].created_at).toDateString()
  const curr = new Date(messages[i].created_at).toDateString()
  return prev !== curr
}
