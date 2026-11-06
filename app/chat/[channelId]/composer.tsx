'use client'

import { useRef, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prepareImage, kindOf, extensionFor, MAX_MEDIA_BYTES, type Attachment, type AttachmentKind } from '@/lib/adapters/images'
import { canRecord, startRecording, formatDuration, MAX_VOICE_SECONDS, type Recording } from '@/lib/adapters/recorder'
import { PhotoConsent } from './photo-consent'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'
import { DEFAULT_TZ, zonedToUtc } from '@/lib/time'

const QUICK = ['👍', '❤️', '✅', '❌', '❓', '😂']

export function Composer({
  channelId, academyId, teamId, myId, canPost, isHost, archived, postingMode,
  replyTo, onCancelReply, lastMessageId, addOptimistic, replaceOptimistic, onScheduled, onTyping,
}: {
  /** 0194: called while this person types, so the others see "typing…". */
  onTyping?: () => void
  channelId: string
  academyId: string
  teamId: string | null
  myId: string
  canPost: boolean
  isHost: boolean
  archived: boolean
  postingMode: string
  replyTo: ChatMessage | null
  /** C-04: a message was queued for later; the strip above reloads. */
  onScheduled?: () => void
  onCancelReply: () => void
  lastMessageId: string | null
  addOptimistic: (m: ChatMessage) => void
  replaceOptimistic: (tempId: string, real: ChatMessage | null) => void
}) {
  const [text, setText] = useState('')
  // "typing…" for the others, at most once every 2.5 seconds; the hook
  // forgets a nudge after four, so a pause reads as a pause.
  const typedAt = useRef(0)
  function nudgeTyping() {
    const now = Date.now()
    if (now - typedAt.current < 2500) return
    typedAt.current = now
    onTyping?.()
  }
  // C-03: who can be named here, fetched once; the ids of those named so far.
  const [people, setPeople] = useState<{ id: string; name: string; label: string | null }[] | null>(null)
  const [mentioned, setMentioned] = useState<{ id: string; name: string }[]>([])
  const mentionQuery = (() => {
    const m = text.match(/(?:^|\s)@([^\s@]{0,30})$/)
    return m ? m[1] : null
  })()
  async function loadPeople() {
    if (people) return
    const { data } = await supabase.rpc('channel_mentionables', { p_channel: channelId })
    setPeople(((data as unknown as { id: string; name: string; label: string | null }[]) ?? []))
  }
  function pick(p: { id: string; name: string }) {
    setText((t) => t.replace(/(^|\s)@[^\s@]{0,30}$/, `$1@${p.name} `))
    setMentioned((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]))
  }
  const candidates = mentionQuery === null || !people ? [] : people.filter((p) => p.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
  const [announcement, setAnnouncement] = useState(false)
  // 0217: the day an announcement is about. Home stops showing it after.
  const [aboutDay, setAboutDay] = useState('')
  // C-04: send later.
  const [laterOpen, setLaterOpen] = useState(false)
  const [laterAt, setLaterAt] = useState('')
  async function scheduleIt() {
    const body = text.trim()
    if (!body || !laterAt) return
    const { error } = await supabase.rpc('schedule_message', { p_channel: channelId, p_body: body, p_at: new Date(laterAt).toISOString(), p_announcement: announcement && isHost })
    if (error) return setError(error.message)
    setText('')
    setLaterOpen(false)
    setLaterAt('')
    setAnnouncement(false)
    setMentioned([])
    onScheduled?.()
  }
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ key: string; file: File; preview: string; kind: AttachmentKind; duration?: number }[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  // C-05: a voice note. The server has no microphone, so it renders the send
  // button and the client swaps in the mic once it knows it has one.
  const canMic = useSyncExternalStore(() => () => {}, canRecord, () => false)
  const [recSeconds, setRecSeconds] = useState<number | null>(null)
  const recRef = useRef<Recording | null>(null)
  async function startVoice() {
    setError(null)
    try {
      const handle = await startRecording((s) => {
        setRecSeconds(s)
        if (s >= MAX_VOICE_SECONDS) void finishVoice()
      })
      recRef.current = handle
      setRecSeconds(0)
    } catch {
      setError('Squadroom needs the microphone for a voice note. Allow it in your browser settings.')
    }
  }
  async function finishVoice() {
    const handle = recRef.current
    if (!handle) return
    recRef.current = null
    const note = await handle.stop()
    setRecSeconds(null)
    if (!note || note.duration < 0.5) return
    const file = new File([note.blob], `voice-note.${extensionFor(note.mime, 'webm')}`, { type: note.mime })
    setPending((prev) => [...prev, { key: crypto.randomUUID(), file, preview: '', kind: 'audio' as const, duration: note.duration }].slice(0, 6))
  }
  function cancelVoice() {
    recRef.current?.cancel()
    recRef.current = null
    setRecSeconds(null)
  }

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

  const [pollOpen, setPollOpen] = useState(false)
  const [pollKind, setPollKind] = useState<'availability' | 'simple'>('availability')
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState('')

  /**
   * A poll is a row plus a message that points at it, the same shape as an
   * event card. Two writes rather than one, but the alternative is copying
   * the question into the message and having two versions of it.
   */
  async function createPoll() {
    const question = pollQuestion.trim()
    if (!question) return

    const options =
      pollKind === 'simple'
        ? pollOptions.split('\n').map((o) => o.trim()).filter(Boolean)
            .map((label, i) => ({ id: `o${i + 1}`, label }))
        : []

    if (pollKind === 'simple' && options.length < 2) {
      return setError('A poll needs at least two options.')
    }

    const { data: poll, error: pErr } = await supabase
      .from('polls')
      .insert({
        academy_id: academyId, channel_id: channelId, type: pollKind,
        question, options, created_by: myId,
      })
      .select('id')
      .single()

    if (pErr || !poll) return setError('Could not create that poll.')

    const { error: mErr } = await supabase.from('messages').insert({
      academy_id: academyId, channel_id: channelId, sender_id: myId, poll_id: poll.id,
    })
    if (mErr) return setError('Poll created but not posted.')

    setPollOpen(false)
    setPollQuestion('')
    setPollOptions('')
    setError(null)
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
    // C-05: a video is refused here, before a byte is sent, rather than by
    // the bucket after thirty seconds of upload on a 4G connection.
    const big = chosen.find((f) => f.size > MAX_MEDIA_BYTES)
    if (big) {
      setError(`${big.name} is too big. Keep videos short — under 25 MB, about thirty seconds.`)
      return
    }
    setPending((prev) => [
      ...prev,
      ...chosen.map((f) => {
        const kind = kindOf(f.type)
        return { key: crypto.randomUUID(), file: f, preview: kind === 'image' ? URL.createObjectURL(f) : '', kind }
      }),
    ].slice(0, 6))
    setError(null)
  }

  function removePending(i: number) {
    setPending((prev) => {
      if (prev[i].preview) URL.revokeObjectURL(prev[i].preview)
      return prev.filter((_, n) => n !== i)
    })
  }

  async function uploadAll(): Promise<Attachment[] | null> {
    if (pending.length === 0) return []
    const out: Attachment[] = []

    for (const { file, duration } of pending) {
      // Photos are downsized on the phone; a voice note or a video goes up
      // as recorded, within the 25 MB the picker already enforced.
      const prepared = await prepareImage(file)
      // The path IS the authorisation: academy / channel / uploader / file.
      // The storage policies read the channel and the uploader straight out
      // of it, so a client cannot write somewhere it has no business.
      const ext = extensionFor(prepared.mime, file.name.split('.').pop() ?? 'bin')
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
        ...(duration ? { duration } : {}),
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
    pending.forEach((p) => { if (p.preview) URL.revokeObjectURL(p.preview) })
    setPending([])
    onCancelReply()
    setError(null)

    // Only names still in the text count; a deleted "@Sarah" mentions nobody.
    const mentions = mentioned.filter((m) => body.includes('@' + m.name)).map((m) => m.id)
    const everyone = isHost && /(^|\s)@everyone(\s|$)/.test(body)
    const row = {
      academy_id: academyId, channel_id: channelId, sender_id: myId,
      body: body || null, attachments: uploaded,
      reply_to_id: replyId, is_announcement: announcement && isHost,
      mentions, mention_everyone: everyone,
    }
    // The end of the day it is about, where the club is (0217).
    const until = announcement && isHost && aboutDay ? zonedToUtc(aboutDay, '23:59', DEFAULT_TZ).toISOString() : null
    let { data, error } = await supabase
      .from('messages')
      // One shape for the checker; the date rides along only when there is one.
      .insert((until ? { ...row, relevant_until: until } : row) as typeof row)
      .select('id, created_at')
      .single()
    // Before 0217 there is no column for the date: the announcement still goes.
    if (error && until && /relevant_until|column|schema cache/i.test(error.message)) {
      ;({ data, error } = await supabase.from('messages').insert(row).select('id, created_at').single())
    }

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
    setAboutDay('')
    setMentioned([])
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
      <div className="border-t border-[var(--line)] p-4 text-center text-sm text-ink-2">
        This season has ended. Everything is still here to read.
      </div>
    )
  }

  if (!canPost) {
    return (
      <div className="border-t border-[var(--line)] p-3">
        <p className="mb-2 text-center text-xs text-ink-2">
          Only hosts post here. You can still react.
        </p>
        <div className="flex gap-1.5">
          {QUICK.map((e) => (
            <button
              key={e}
              onClick={() => quickReact(e)}
              className="flex-1 rounded-lg border border-[var(--line)] py-1.5 text-lg active:bg-[var(--surface-2)]"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--line)]">
      {replyTo && (
        <div className="flex items-center gap-2 border-b border-[var(--line-2)] px-4 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-ink-2">
            Replying to <b>{replyTo.sender_name}</b>: {replyTo.body}
          </span>
          <button onClick={onCancelReply} className="text-ink-3">✕</button>
        </div>
      )}

      {error && <p className="px-4 pt-2 text-xs ">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2 text-xs text-ink-2">
        {isHost && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={announcement}
              onChange={(e) => setAnnouncement(e.target.checked)}
            />
            Send as an announcement
          </label>
        )}
        {isHost && announcement && (
          <label className="flex items-center gap-2" data-about-day>
            About a day?
            <input
              type="date"
              value={aboutDay}
              onChange={(e) => setAboutDay(e.target.value)}
              className="rounded-lg border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--line)' }}
              aria-label="The day it is about — Home stops showing it after"
            />
          </label>
        )}
        {canPost && !archived && (
          <button onClick={() => setLaterOpen((v) => !v)} className="tap underline underline-offset-2">
            {laterOpen ? 'Send now instead' : 'Send later…'}
          </button>
        )}
      </div>
      {laterOpen && (
        <div className="flex items-center gap-2 px-4 pt-1.5 text-xs">
          <input type="datetime-local" value={laterAt} onChange={(e) => setLaterAt(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} />
          <button onClick={scheduleIt} disabled={!text.trim() || !laterAt || uploading} className="rounded-lg px-3 py-1.5 font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            Schedule
          </button>
          <span className="text-ink-3">Text only; photos go now.</span>
        </div>
      )}

      {/* Only once images are attached. A permanent notice above the
          composer is a notice nobody sees, and the moment it matters is the
          moment before posting. */}
      {/* A video of training is a photo of training, thirty times a second. */}
      {pending.some((p) => p.kind === 'image' || p.kind === 'video') && <PhotoConsent channelId={channelId} />}

      {pending.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-2">
          {pending.map((p, i) => (
            <div key={p.key} className="relative flex-none">
              {p.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div
                  className="flex h-16 max-w-[11.25rem] items-center gap-2 rounded-lg border px-3 text-sm"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                >
                  <span className="text-lg" aria-hidden>{p.kind === 'audio' ? '🎙' : p.kind === 'video' ? '🎬' : '📄'}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {p.kind === 'audio' ? 'Voice note' : p.kind === 'video' ? 'Video' : p.file.name}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {p.duration ? formatDuration(p.duration) : `${(p.file.size / 1048576).toFixed(1)} MB`}
                    </span>
                  </span>
                </div>
              )}
              <button
                onClick={() => removePending(i)}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--brand)] text-xs text-brand-ink"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {pollOpen && (
        <div className="border-b border-[var(--line-2)] p-3">
          <div className="mb-2 flex gap-1">
            {(['availability', 'simple'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setPollKind(k)}
                className="flex-1 rounded-lg border py-1.5 text-xs font-semibold"
                style={pollKind === k
                  ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--brand-text)' }
                  : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              >
                {k === 'availability' ? 'Who’s available' : 'Question'}
              </button>
            ))}
          </div>

          <textarea
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value)}
            rows={2}
            aria-label="Poll question"
            placeholder={pollKind === 'availability'
              ? 'Gala Day — Sun 20 Sep, Valentine Park. Who’s available?'
              : 'What should we do for the end of season?'}
            className="w-full rounded-lg border border-[var(--line)] p-2 text-sm"
          />

          {pollKind === 'simple' ? (
            <textarea
              value={pollOptions}
              onChange={(e) => setPollOptions(e.target.value)}
              rows={3}
              aria-label="Poll options, one per line"
              placeholder={'One option per line\nBBQ at the park\nBowling\nPresentation night'}
              className="mt-2 w-full rounded-lg border border-[var(--line)] p-2 text-sm"
            />
          ) : (
            <p className="mt-1 text-xs text-ink-2">
              Each family answers yes, maybe or no for each of their children.
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <button
              onClick={createPoll}
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink"
              style={{ background: 'var(--brand)' }}
            >
              Post the poll
            </button>
            <button onClick={() => setPollOpen(false)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {fixtures && (
        <div className="max-h-56 overflow-y-auto border-b border-[var(--line-2)]">
          {fixtures.length === 0 && (
            <p className="p-3 text-center text-sm text-ink-2">Nothing coming up for this team.</p>
          )}
          {fixtures.map((f) => (
            <button
              key={f.id}
              onClick={() => shareFixture(f.id)}
              className="flex w-full items-center gap-3 border-b border-[var(--line-2)] px-4 py-2.5 text-left active:bg-[var(--surface-3)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.title}</span>
                <span className="block text-xs capitalize text-ink-2">
                  {f.type} ·{' '}
                  {new Date(f.starts_at).toLocaleString('en-AU', { timeZone: DEFAULT_TZ,
                    weekday: 'short', day: 'numeric', month: 'short',
                    hour: 'numeric', minute: '2-digit',
                  })}
                </span>
              </span>
              <span className="flex-none text-xs font-semibold" style={{ color: 'var(--brand-text)' }}>Post</span>
            </button>
          ))}
        </div>
      )}

      {mentionQuery !== null && (candidates.length > 0 || (isHost && 'everyone'.startsWith(mentionQuery.toLowerCase()))) && (
        <ul className="mx-3 mb-1 overflow-hidden rounded-xl border text-sm" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          {isHost && 'everyone'.startsWith(mentionQuery.toLowerCase()) && (
            <li>
              <button onClick={() => pick({ id: 'everyone', name: 'everyone' })} className="flex w-full items-baseline gap-2 px-3 py-2 text-left">
                <span className="font-medium">@everyone</span>
                <span className="text-xs text-ink-3">the whole channel, mutes and all</span>
              </button>
            </li>
          )}
          {candidates.map((p) => (
            <li key={p.id} className="border-t" style={{ borderColor: 'var(--line-2)' }}>
              <button onClick={() => pick(p)} className="flex w-full items-baseline gap-2 px-3 py-2 text-left">
                <span className="font-medium">{p.name}</span>
                {p.label && <span className="truncate text-xs text-ink-3">{p.label}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2 p-3">
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => { pickFiles(e.target.files); e.target.value = '' }}
        />
        {recSeconds !== null ? (
          // Recording. The row becomes the recorder: a pulsing dot, the
          // clock, and the two choices there are.
          <div className="flex flex-1 items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[0.9375rem]" style={{ background: 'var(--surface-2)' }} role="status" aria-live="polite">
            <span className="h-2.5 w-2.5 flex-none animate-pulse rounded-full" style={{ background: 'var(--no)' }} aria-hidden />
            <span className="flex-1 tabular-nums">Recording {formatDuration(recSeconds)}</span>
            <button onClick={cancelVoice} className="text-sm text-ink-3 underline underline-offset-2">Cancel</button>
            <button onClick={finishVoice} className="rounded-lg px-3 py-1 text-sm font-semibold text-brand-ink" style={{ background: 'var(--brand)' }}>Done</button>
          </div>
        ) : (
        <>
        <button
          onClick={() => fileInput.current?.click()}
          className="grid h-10 w-10 flex-none place-items-center rounded-full text-xl text-ink-2"
          aria-label="Add a photo or video"
        >
          ＋
        </button>
        {isHost && (
          <button
            onClick={() => { setPollOpen((v) => !v); setFixtures(null) }}
            className="grid h-10 w-9 flex-none place-items-center rounded-full text-lg text-ink-2"
            aria-label="Create a poll"
          >
            📊
          </button>
        )}
        {isHost && (
          <button
            onClick={openFixtures}
            className="grid h-10 w-9 flex-none place-items-center rounded-full text-lg text-ink-2"
            aria-label="Share a fixture"
          >
            📅
          </button>
        )}
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); if (e.target.value.includes('@')) void loadPeople(); if (e.target.value) nudgeTyping() }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (candidates.length > 0 && mentionQuery !== null) pick(candidates[0])
              else send()
            }
          }}
          rows={1}
          aria-label="Message"
          placeholder={
            !isHost && postingMode === 'replies_only' ? 'Reply to the team…' : 'Message'
          }
          className="max-h-32 flex-1 resize-none rounded-2xl bg-[var(--surface-2)] px-3.5 py-2.5 text-[0.9375rem] outline-none"
        />
        {canMic && !text.trim() && pending.length === 0 ? (
          // Nothing typed, nothing attached: the button is a microphone, the
          // way every messaging app a parent already uses does it.
          <button
            onClick={startVoice}
            className="grid h-10 w-10 flex-none place-items-center rounded-full text-brand-ink"
            style={{ background: 'var(--brand)' }}
            aria-label="Record a voice note"
          >
            🎙
          </button>
        ) : (
          <button
            onClick={send}
            disabled={(!text.trim() && pending.length === 0) || uploading}
            className="grid h-10 w-10 flex-none place-items-center rounded-full text-brand-ink disabled:opacity-40"
            style={{ background: 'var(--brand)' }}
            aria-label="Send"
          >
            {uploading ? '…' : '↑'}
          </button>
        )}
        </>
        )}
      </div>
    </div>
  )
}
