'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'

const QUICK = ['👍', '❤️', '✅', '❌', '❓', '😂']

export function Composer({
  channelId, academyId, myId, canPost, isHost, archived, postingMode,
  replyTo, onCancelReply, lastMessageId, addOptimistic, replaceOptimistic,
}: {
  channelId: string
  academyId: string
  myId: string
  canPost: boolean
  isHost: boolean
  archived: boolean
  postingMode: string
  replyTo: ChatMessage | null
  onCancelReply: () => void
  lastMessageId: string | null
  addOptimistic: (m: ChatMessage) => void
  replaceOptimistic: (tempId: string, real: ChatMessage | null) => void
}) {
  const [text, setText] = useState('')
  const [announcement, setAnnouncement] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function send() {
    const body = text.trim()
    if (!body) return

    // replies_only means exactly that: a parent's message has to attach to
    // something. Attaching it to the latest message is what they meant.
    const replyId = replyTo?.id ?? (!isHost && postingMode === 'replies_only' ? lastMessageId : null)

    const tempId = `temp-${crypto.randomUUID()}`
    addOptimistic({
      id: tempId, body, attachments: [], sender_id: myId, sender_name: 'You',
      sender_role: null, reply_to_id: replyId, reply_to_body: replyTo?.body ?? null,
      reply_to_name: replyTo?.sender_name ?? null, is_announcement: announcement,
      pinned_at: null, created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
    })
    setText('')
    onCancelReply()
    setError(null)

    const { data, error } = await supabase
      .from('messages')
      .insert({
        academy_id: academyId, channel_id: channelId, sender_id: myId,
        body, reply_to_id: replyId, is_announcement: announcement && isHost,
      })
      .select('id, created_at')
      .single()

    if (error) {
      replaceOptimistic(tempId, null)
      setText(body)
      // The database refused it, so say what the database is enforcing rather
      // than "something went wrong" — the rule is knowable and worth stating.
      return setError(
        error.code === '42501'
          ? postingMode === 'hosts_only'
            ? 'Only hosts can post here. You can still react.'
            : 'You can only reply to a message in this channel.'
          : 'Message not sent.'
      )
    }

    setAnnouncement(false)
    replaceOptimistic(tempId, null)
  }

  async function quickReact(emoji: string) {
    if (!lastMessageId) return
    await supabase.from('message_reactions').insert({
      academy_id: academyId, message_id: lastMessageId, profile_id: myId, emoji,
    })
  }

  if (archived) {
    return (
      <div className="border-t border-neutral-200 p-4 text-center text-sm text-neutral-500">
        This season has ended. Everything is still here to read.
      </div>
    )
  }

  if (!canPost) {
    return (
      <div className="border-t border-neutral-200 p-3">
        <p className="mb-2 text-center text-xs text-neutral-500">
          Only hosts post here. You can still react.
        </p>
        <div className="flex gap-1.5">
          {QUICK.map((e) => (
            <button
              key={e}
              onClick={() => quickReact(e)}
              className="flex-1 rounded-lg border border-neutral-200 py-1.5 text-lg active:bg-neutral-100"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-neutral-200">
      {replyTo && (
        <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-neutral-500">
            Replying to <b>{replyTo.sender_name}</b>: {replyTo.body}
          </span>
          <button onClick={onCancelReply} className="text-neutral-400">✕</button>
        </div>
      )}

      {error && <p className="px-4 pt-2 text-xs text-red-600">{error}</p>}

      {isHost && (
        <label className="flex items-center gap-2 px-4 pt-2 text-xs text-neutral-500">
          <input
            type="checkbox"
            checked={announcement}
            onChange={(e) => setAnnouncement(e.target.checked)}
          />
          Send as an announcement
        </label>
      )}

      <div className="flex items-end gap-2 p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
          }}
          rows={1}
          placeholder={
            !isHost && postingMode === 'replies_only' ? 'Reply to the team…' : 'Message'
          }
          className="max-h-32 flex-1 resize-none rounded-2xl bg-neutral-100 px-3.5 py-2.5 text-[15px] outline-none"
        />
        <button
          onClick={send}
          disabled={!text.trim()}
          className="grid h-10 w-10 flex-none place-items-center rounded-full text-white disabled:opacity-40"
          style={{ background: '#202842' }}
          aria-label="Send"
        >
          ↑
        </button>
      </div>
    </div>
  )
}
