'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useTranslations } from '@/lib/hooks/use-translations'
import { useChannelMessages, type ChatMessage } from '@/lib/hooks/use-channel-messages'
import { MessageBubble } from './message-bubble'
import { Composer } from './composer'
import { PendingQueue } from './pending-queue'
import { ScheduledStrip } from './scheduled-strip'
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
  const { messages, loadOlder, hasMore, loadingOlder, addOptimistic, replaceOptimistic, typing, sayTyping } =
    useChannelMessages(channelId, initialMessages)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  // W-08: the language this person reads in (Settings); null is as written.
  const [lang, setLang] = useState<string | null>(null)
  // The name the "typing…" line shows other people.
  const [myName, setMyName] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      const { data } = await createClient().from('profiles').select('chat_language, full_name').eq('id', myId).maybeSingle()
      setLang(data?.chat_language ?? null)
      setMyName(data?.full_name ?? null)
    })()
  }, [myId])

  // Ticks on my own messages: how many of the others have opened the
  // channel since each was sent (0194 read_receipts). The last thirty are
  // enough — nobody checks the ticks on last month's message.
  const [receipts, setReceipts] = useState<Record<string, { read: number; total: number }>>({})
  const myIdsKey = useMemo(
    () => messages.filter((m) => m.sender_id === myId && !m.deleted_at && /^[0-9a-f-]{36}$/.test(m.id)).slice(-30).map((m) => m.id).join(','),
    [messages, myId]
  )
  useEffect(() => {
    if (!myIdsKey) return
    let live = true
    const load = async () => {
      const { data } = await supabase.current.rpc('read_receipts', { p_channel: channelId, p_message_ids: myIdsKey.split(',') })
      if (!live || !data) return
      setReceipts((prev) => {
        const next = { ...prev }
        for (const r of data) next[r.message_id] = { read: r.read_count, total: r.member_count }
        return next
      })
    }
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 15_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [channelId, myIdsKey])

  // "Sarah is typing…" — everyone but me, newest first is not needed.
  const typingNames = Object.entries(typing).filter(([id]) => id !== myId).map(([, v]) => v.name.split(' ')[0])
  const typingLine =
    typingNames.length === 0 ? null
      : typingNames.length === 1 ? `${typingNames[0]} is typing…`
      : typingNames.length === 2 ? `${typingNames[0]} and ${typingNames[1]} are typing…`
      : `${typingNames[0]} and ${typingNames.length - 1} others are typing…`
  const translations = useTranslations(messages, lang)
  const [showSettings, setShowSettings] = useState(false)
  // C-04: bumps when a message is queued for later, so the strip reloads.
  const [scheduledKey, setScheduledKey] = useState(0)
  // C-06: replies to an announcement that is on screen sit under it, folded.
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set())
  const onScreen = useMemo(() => new Set(messages.map((m) => m.id)), [messages])
  const threads = useMemo(() => {
    const t = new Map<string, ChatMessage[]>()
    for (const m of messages) {
      if (m.reply_to_announcement && m.reply_to_id && onScreen.has(m.reply_to_id)) {
        t.set(m.reply_to_id, [...(t.get(m.reply_to_id) ?? []), m])
      }
    }
    return t
  }, [messages, onScreen])
  const topLevel = useMemo(() => messages.filter((m) => !(m.reply_to_announcement && m.reply_to_id && onScreen.has(m.reply_to_id))), [messages, onScreen])
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
        data-app-bar
        className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3.5 pt-3"
        style={{ background: 'var(--bar)', color: 'var(--bar-ink)', borderBottom: '1px solid var(--bar-line)' }}
      >
        <Link
          href="/chat"
          aria-label="Back to chats"
          className="-ml-1 grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
          style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }}
        >
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="display truncate text-[1.3125rem] leading-tight">{name}</h1>
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
          style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)' }}
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

        {topLevel.map((m, i) => (
          <div key={m.id}>
            <MessageBubble
              message={m}
              translation={translations[m.id] ?? null}
              mine={m.sender_id === myId}
              isHost={isHost}
              academyId={academyId}
              myId={myId}
              showDay={showDaySeparator(topLevel, i)}
              onReply={() => setReplyTo(m)}
              receipt={m.sender_id === myId ? receipts[m.id] ?? null : null}
            />
            {threads.has(m.id) && (
              <div className="mb-2 ml-4">
                <button
                  onClick={() => setOpenThreads((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
                  className="tap mb-1 text-xs font-semibold underline underline-offset-2"
                  style={{ color: 'var(--brand-text)' }}
                >
                  {openThreads.has(m.id) ? 'Hide replies' : `${threads.get(m.id)!.length} ${threads.get(m.id)!.length === 1 ? 'reply' : 'replies'} ›`}
                </button>
                {openThreads.has(m.id) && threads.get(m.id)!.map((r) => (
                  <MessageBubble
                    key={r.id}
                    message={r}
                    translation={translations[r.id] ?? null}
                    mine={r.sender_id === myId}
                    isHost={isHost}
                    academyId={academyId}
                    myId={myId}
                    showDay={false}
                    onReply={() => setReplyTo(m)}
                    receipt={r.sender_id === myId ? receipts[r.id] ?? null : null}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {typingLine && (
        <p data-typing className="px-4 py-1 text-xs italic text-ink-2" style={{ background: 'var(--paper)' }} aria-live="polite">
          {typingLine}
        </p>
      )}
      <ScheduledStrip channelId={channelId} refreshKey={scheduledKey} />
      <Composer
        onScheduled={() => setScheduledKey((k) => k + 1)}
        onTyping={() => { if (myName) sayTyping(myId, myName) }}
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
