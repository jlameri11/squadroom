'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prepareImage, type Attachment } from '@/lib/adapters/images'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'

const QUICK = ['👍', '❤️', '✅', '❌', '❓', '😂']

export function Composer({
  channelId, academyId, teamId, myId, canPost, isHost, archived, postingMode,
  replyTo, onCancelReply, lastMessageId, addOptimistic, replaceOptimistic,
}: {
  channelId: string
  academyId: string
  teamId: string | null
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
  const [pending, setPending] = useState<{ file: File; preview: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  type Upcoming = { id: string; title: string; starts_at: string; type: string }
  const [fixtures, setFixtures] = useState<Upcoming[] | null>(null)

  /**
   * Sharing a fixture posts a reference, not a copy of its details. Moving
   * the game later updates the card that is already in the thread, instead
   * of leaving a stale time being read by people arriving an hour early.
   */
  async function openFixtures() {
    if (fixtures) return setFixtures(null)
    let q = supabase
      .from('events')
      .select('id, title, starts_at, type')
      .gte('starts_at', new Date(Date.now() - 3 * 3600_000).toISOString())
      .is('cancelled_at', null)
      .order('starts_at')
      .limit(10)
    if (teamId) q = q.or(`team_id.eq.${teamId},team_id.is.null`)
    const { data } = await q
    setFixtures((data ?? []) as Upcoming[])
  }

  async function shareFixture(eventId: string) {
    setFixtures(null)
    const { error } = await supabase.from('messages').insert({
      academy_id: academyId, channel_id: channelId, sender_id: myId,
      event_id: eventId, body: null,
    })
    if (error) setError('Could not post that fixture.')
  }

  function pickFiles(files: FileList | null) {
    if (!files) return
    // A few at a time. Someone selecting their whole camera roll is almost
    // always a mistake, and a 40-image message is unreadable anyway.
    const chosen = Array.from(files).slice(0, 6)
    setPending((prev) => [...prev, ...chosen.map((f) => ({ file: f, preview: URL.createObjectURL(f) }))].slice(0, 6))
    setError(null)
  }

  function removePending(i: number) {
    setPending((prev) => {
      URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, n) => n !== i)
    })
  }

  async function uploadAll(): Promise<Attachment[] | null> {
    if (pending.length === 0) return []
    const out: Attachment[] = []

    for (const { file } of pending) {
      const prepared = await prepareImage(file)
      // The path IS the authorisation: academy / channel / uploader / file.
      // The storage policies read the channel and the uploader straight out
      // of it, so a client cannot write somewhere it has no business.
      const ext = prepared.mime === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() ?? 'bin')
      const path = `${academyId}/${channelId}/${myId}/${crypto.randomUUID()}.${ext}`

      const { error } = await supabase.storage
        .from('attachments')
        .upload(path, prepared.blob, { contentType: prepared.mime, upsert: false })

      if (error) {
        setError(
          error.message.toLowerCase().includes('mime')
            ? 'That file type is not allowed.'
            : 'Could not upload that. Check your connection.'
        )
        return null
      }

      out.push({
        path, mime: prepared.mime, size: prepared.blob.size,
        width: prepared.width, height: prepared.height, name: file.name,
      })
    }
    return out
  }

  async function send() {
    const body = text.trim()
    if (!body && pending.length === 0) return

    setUploading(true)
    const uploaded = await uploadAll()
    setUploading(false)
    if (uploaded === null) return   // upload failed; keep what they typed

    // replies_only means exactly that: a parent's message has to attach to
    // something. Attaching it to the latest message is what they meant.
    const replyId = replyTo?.id ?? (!isHost && postingMode === 'replies_only' ? lastMessageId : null)

    const tempId = `temp-${crypto.randomUUID()}`
    addOptimistic({
      id: tempId, body: body || null, attachments: uploaded, sender_id: myId, sender_name: 'You',
      sender_role: null, reply_to_id: replyId, reply_to_body: replyTo?.body ?? null,
      reply_to_name: replyTo?.sender_name ?? null, is_announcement: announcement,
      pinned_at: null, created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
    })
    setText('')
    pending.forEach((p) => URL.revokeObjectURL(p.preview))
    setPending([])
    onCancelReply()
    setError(null)

    const { data, error } = await supabase
      .from('messages')
      .insert({
        academy_id: academyId, channel_id: channelId, sender_id: myId,
        body: body || null, attachments: uploaded,
        reply_to_id: replyId, is_announcement: announcement && isHost,
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

      {pending.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-2">
          {pending.map((p, i) => (
            <div key={p.preview} className="relative flex-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
              <button
                onClick={() => removePending(i)}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-neutral-900 text-xs text-white"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {fixtures && (
        <div className="max-h-56 overflow-y-auto border-b border-neutral-100">
          {fixtures.length === 0 && (
            <p className="p-3 text-center text-sm text-neutral-500">Nothing coming up for this team.</p>
          )}
          {fixtures.map((f) => (
            <button
              key={f.id}
              onClick={() => shareFixture(f.id)}
              className="flex w-full items-center gap-3 border-b border-neutral-50 px-4 py-2.5 text-left active:bg-neutral-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.title}</span>
                <span className="block text-xs capitalize text-neutral-500">
                  {f.type} ·{' '}
                  {new Date(f.starts_at).toLocaleString('en-AU', {
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </span>
              <span className="flex-none text-xs font-semibold" style={{ color: '#202842' }}>Post</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          className="grid h-10 w-10 flex-none place-items-center rounded-full text-xl text-neutral-500"
          aria-label="Add a photo"
        >
          ＋
        </button>
        {isHost && (
          <button
            onClick={openFixtures}
            className="grid h-10 w-9 flex-none place-items-center rounded-full text-lg text-neutral-500"
            aria-label="Share a fixture"
          >
            📅
          </button>
        )}
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
          disabled={(!text.trim() && pending.length === 0) || uploading}
          className="grid h-10 w-10 flex-none place-items-center rounded-full text-white disabled:opacity-40"
          style={{ background: '#202842' }}
          aria-label="Send"
        >
          {uploading ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}
