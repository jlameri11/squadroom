'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prepareImage, kindOf, extensionFor, MAX_MEDIA_BYTES, type Attachment, type AttachmentKind } from '@/lib/adapters/images'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'

type Audience = 'everyone' | 'club_staff'

/**
 * Posting a notice to a competition (Joey, 5 Nov 2026; 0213).
 *
 * One choice and nothing else: Everyone, or Club staff only. Words and files
 * as in chat; no polls, fixtures, mentions or voice notes, because a notice
 * is read by every club in the competition and answered by none of them.
 *
 * A club-staff notice's files go under `…/staff/`, which the bucket's policy
 * keeps from families exactly as the message's policy keeps the words.
 *
 * After it is posted the server is asked to email it (RESEND_API_KEY); with
 * no key it says nothing and does nothing, and the notice has still arrived
 * in the app and by push.
 */
export function NoticeComposer({
  channelId, academyId, myId, canPost, archived, league, addOptimistic, replaceOptimistic,
}: {
  channelId: string
  academyId: string
  myId: string
  canPost: boolean
  archived: boolean
  league: string
  addOptimistic: (m: ChatMessage) => void
  replaceOptimistic: (tempId: string, real: ChatMessage | null) => void
}) {
  const [audience, setAudience] = useState<Audience>('everyone')
  const [text, setText] = useState('')
  const [pending, setPending] = useState<{ key: string; file: File; kind: AttachmentKind }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (archived) {
    return (
      <div className="border-t border-[var(--line)] p-4 text-center text-sm text-ink-2" data-notices-footer>
        This competition has ended. Its notices are still here to read.
      </div>
    )
  }

  if (!canPost) {
    return (
      <div className="border-t border-[var(--line)] p-4 text-center text-sm text-ink-2" data-notices-footer>
        Only {league} posts here. Notices come to you in the app and by push.
      </div>
    )
  }

  function pickFiles(files: FileList | null) {
    if (!files) return
    const chosen = Array.from(files).slice(0, 6)
    const big = chosen.find((f) => f.size > MAX_MEDIA_BYTES)
    if (big) return setError(`${big.name} is too big. Keep it under 25 MB.`)
    setPending((prev) => [...prev, ...chosen.map((f) => ({ key: crypto.randomUUID(), file: f, kind: kindOf(f.type) }))].slice(0, 6))
    setError(null)
  }

  async function upload(supabase: ReturnType<typeof createClient>): Promise<Attachment[] | null> {
    const out: Attachment[] = []
    for (const { file } of pending) {
      const prepared = await prepareImage(file)
      const ext = extensionFor(prepared.mime, file.name.split('.').pop() ?? 'bin')
      // Club staff only: under staff/, so the bucket keeps it from families too.
      const folder = audience === 'club_staff' ? `${academyId}/${channelId}/${myId}/staff` : `${academyId}/${channelId}/${myId}`
      const path = `${folder}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('attachments').upload(path, prepared.blob, { contentType: prepared.mime, upsert: false })
      if (error) {
        setError(error.message.toLowerCase().includes('mime') ? 'That file type is not allowed.' : 'Could not upload that. Check your connection.')
        return null
      }
      out.push({ path, mime: prepared.mime, size: prepared.blob.size, width: prepared.width, height: prepared.height, name: file.name })
    }
    return out
  }

  async function post() {
    const body = text.trim()
    if (!body && pending.length === 0) return
    setBusy(true)
    setError(null)
    setSent(null)
    const supabase = createClient()
    const files = await upload(supabase)
    if (files === null) {
      setBusy(false)
      return
    }
    const tempId = `temp-${crypto.randomUUID()}`
    addOptimistic({
      id: tempId, body: body || null, attachments: files, sender_id: myId, sender_name: 'You', sender_role: null,
      reply_to_id: null, reply_to_body: null, reply_to_name: null, is_announcement: true, pinned_at: null,
      created_at: new Date().toISOString(), edited_at: null, deleted_at: null, audience,
    })
    const { data, error } = await supabase
      .from('messages')
      .insert({ academy_id: academyId, channel_id: channelId, sender_id: myId, body: body || null, attachments: files, is_announcement: true, audience })
      .select('id')
      .single()
    setBusy(false)
    replaceOptimistic(tempId, null)
    if (error || !data) {
      setText(body)
      return setError(error?.code === '42501' ? `Only ${league} posts here.` : 'Notice not sent.')
    }
    setText('')
    setPending([])
    setSent(audience === 'club_staff' ? 'Sent to club staff.' : 'Sent to everyone in the competition.')
    // Emailed by the server when email is set up; silent when it is not.
    void fetch('/api/notices/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: data.id }),
    }).catch(() => null)
  }

  const choice = (value: Audience, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={audience === value}
      onClick={() => setAudience(value)}
      className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
      style={audience === value ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 2px #0000001a' } : { color: 'var(--ink-2)' }}
      data-audience={value}
    >
      {label}
    </button>
  )

  return (
    <div className="border-t border-[var(--line)] p-3" data-notice-composer>
      <div className="flex flex-wrap gap-1.5 rounded-xl p-1" style={{ background: 'var(--surface-2)' }} role="radiogroup" aria-label="Who this notice is for">
        {choice('everyone', 'Everyone')}
        {choice('club_staff', 'Club staff only')}
      </div>
      <p className="mt-1.5 px-1 text-xs text-ink-3" data-audience-hint>
        {audience === 'everyone'
          ? 'Every club’s staff, every family in an entered team, and the referees.'
          : 'The entered clubs’ owners, admins and coaches, and the league. No families.'}
      </p>

      {error && <p className="mt-2 px-1 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      {sent && <p className="mt-2 px-1 text-xs text-ink-2" role="status">{sent}</p>}

      {pending.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {pending.map((p, i) => (
            <li key={p.key} className="flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--line)' }}>
              <span aria-hidden>{p.kind === 'image' ? '🖼' : p.kind === 'video' ? '🎬' : p.kind === 'audio' ? '🎙' : '📄'}</span>
              <span className="min-w-0 truncate">{p.file.name}</span>
              <button onClick={() => setPending((prev) => prev.filter((_, n) => n !== i))} className="tap text-ink-3" aria-label={`Remove ${p.file.name}`}>✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf,video/*"
          multiple
          className="hidden"
          onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          className="grid h-10 w-10 flex-none place-items-center rounded-full text-xl text-ink-2"
          aria-label="Attach a photo or a PDF"
        >
          ＋
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="Notice"
          placeholder="Round 12 is off — grounds closed. Details Monday."
          className="max-h-40 min-w-0 flex-1 resize-none rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5 text-[0.9375rem] outline-none"
        />
        <button
          onClick={post}
          disabled={busy || (!text.trim() && pending.length === 0)}
          className="h-10 flex-none rounded-full px-4 text-sm font-semibold text-brand-ink disabled:opacity-40"
          style={{ background: 'var(--brand)' }}
          data-post-notice
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
