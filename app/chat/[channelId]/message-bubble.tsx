'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'
import { MessageAttachments } from './attachments'
import { EventCard, type CardEvent } from './event-card'
import { ContactSheet } from './contact-sheet'

const QUICK = ['👍', '❤️', '✅', '❌', '❓', '😂']

type Count = { emoji: string; reaction_count: number; reacted_by_me: boolean }

export function MessageBubble({
  message, mine, isHost, academyId, myId, showDay, onReply,
}: {
  message: ChatMessage
  mine: boolean
  isHost: boolean
  academyId: string
  myId: string
  showDay: boolean
  onReply: () => void
}) {
  const [counts, setCounts] = useState<Count[]>([])
  const [picking, setPicking] = useState(false)
  const [voters, setVoters] = useState<string | null>(null)
  const [showContact, setShowContact] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    supabase.rpc('reaction_counts', { p_message_ids: [message.id] }).then(({ data }) => {
      if (!cancelled) setCounts((data ?? []) as Count[])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id])

  async function react(emoji: string) {
    setPicking(false)
    const existing = counts.find((c) => c.emoji === emoji)

    // Optimistic: reacting should feel instant, it is the cheapest thing in
    // the app and the one parents in a broadcast channel can actually do.
    setCounts((prev) => {
      if (existing?.reacted_by_me) {
        return prev
          .map((c) => (c.emoji === emoji ? { ...c, reaction_count: c.reaction_count - 1, reacted_by_me: false } : c))
          .filter((c) => c.reaction_count > 0)
      }
      return existing
        ? prev.map((c) => (c.emoji === emoji ? { ...c, reaction_count: c.reaction_count + 1, reacted_by_me: true } : c))
        : [...prev, { emoji, reaction_count: 1, reacted_by_me: true }]
    })

    if (existing?.reacted_by_me) {
      await supabase.from('message_reactions').delete()
        .eq('message_id', message.id).eq('emoji', emoji).eq('profile_id', myId)
    } else {
      await supabase.from('message_reactions')
        .insert({ academy_id: academyId, message_id: message.id, profile_id: myId, emoji })
    }
  }

  async function whoReacted(emoji: string) {
    if (!isHost) {
      const c = counts.find((x) => x.emoji === emoji)
      setVoters(`${c?.reaction_count ?? 0} ${c?.reaction_count === 1 ? 'person' : 'people'}`)
      return
    }
    const { data, error } = await supabase.rpc('get_reaction_voters', {
      p_message: message.id, p_emoji: emoji,
    })
    setVoters(error ? 'Could not load' : (data ?? []).map((v) => v.full_name).join(', ') || 'Nobody yet')
  }

  const day = new Date(message.created_at)
  const time = day.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

  return (
    <>
      {showDay && (
        <div className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          {dayLabel(day)}
        </div>
      )}

      <div className={`mb-2.5 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && (
          <button
            onClick={() => message.sender_id && setShowContact(true)}
            className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-medium text-neutral-500 underline-offset-2 hover:underline"
          >
            {message.sender_name ?? 'Unknown'}
            {message.sender_role && message.sender_role !== 'parent' && (
              <span className="rounded bg-neutral-100 px-1 py-px text-[10px] capitalize">{message.sender_role}</span>
            )}
          </button>
        )}

        {showContact && message.sender_id && (
          <ContactSheet
            academyId={academyId}
            profileId={message.sender_id}
            onClose={() => setShowContact(false)}
          />
        )}

        <div
          onDoubleClick={onReply}
          className={`${message.event ? 'w-[85%] max-w-[85%] p-0' : 'max-w-[85%] px-3 py-2'} rounded-2xl ${
            message.is_announcement
              ? 'border-2'
              : mine
                ? 'text-white'
                : 'border border-neutral-200 bg-white'
          }`}
          style={
            message.is_announcement
              ? { borderColor: '#202842', background: '#2028420d', color: '#111' }
              : message.event
                ? { background: 'transparent', border: 'none' }
                : mine
                  ? { background: '#202842' }
                  : undefined
          }
        >
          {message.is_announcement && (
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: '#202842' }}>
              Announcement
            </span>
          )}

          {message.reply_to_id && (
            <div className={`mb-1.5 border-l-2 pl-2 text-xs ${mine && !message.is_announcement ? 'border-white/40 text-white/80' : 'border-neutral-300 text-neutral-500'}`}>
              <span className="font-medium">{message.reply_to_name ?? 'Someone'}</span>
              <span className="block truncate">{message.reply_to_body ?? 'Message deleted'}</span>
            </div>
          )}

          {!message.deleted_at && message.event ? (
            <EventCard
              event={message.event as CardEvent}
              academyId={academyId}
              isCoach={isHost}
            />
          ) : null}

          {!message.deleted_at && <MessageAttachments attachments={message.attachments} />}

          {message.deleted_at ? (
            <span className={`text-sm italic ${mine && !message.is_announcement ? 'text-white/60' : 'text-neutral-400'}`}>
              Message deleted
            </span>
          ) : (
            message.body && (
              <span className="whitespace-pre-wrap break-words text-[15px] leading-snug">{message.body}</span>
            )
          )}

          <span className={`mt-0.5 block text-right text-[10px] tabular-nums ${mine && !message.is_announcement ? 'text-white/60' : 'text-neutral-400'}`}>
            {time}{message.edited_at && ' · edited'}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          {counts.map((c) => (
            <button
              key={c.emoji}
              onClick={() => react(c.emoji)}
              onContextMenu={(e) => { e.preventDefault(); whoReacted(c.emoji) }}
              className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${
                c.reacted_by_me ? 'border-neutral-800 bg-neutral-100' : 'border-neutral-200'
              }`}
            >
              <span>{c.emoji}</span>
              <span className="font-semibold text-neutral-600">{c.reaction_count}</span>
            </button>
          ))}

          <button
            onClick={() => setPicking((v) => !v)}
            className="rounded-full border border-dashed border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-400"
            aria-label="Add a reaction"
          >
            ＋
          </button>

          {!message.deleted_at && (
            <button onClick={onReply} className="px-1 text-xs text-neutral-400">Reply</button>
          )}
        </div>

        {picking && (
          <div className="mt-1 flex gap-1 rounded-full border border-neutral-200 bg-white p-1 shadow-sm">
            {QUICK.map((e) => (
              <button key={e} onClick={() => react(e)} className="px-1.5 text-lg">{e}</button>
            ))}
          </div>
        )}

        {voters && (
          <button onClick={() => setVoters(null)} className="mt-1 max-w-[85%] text-left text-xs text-neutral-500">
            {voters} — tap to hide
          </button>
        )}
      </div>
    </>
  )
}

function dayLabel(d: Date) {
  const today = new Date().toDateString()
  const yest = new Date(Date.now() - 86400000).toDateString()
  if (d.toDateString() === today) return 'Today'
  if (d.toDateString() === yest) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
}
