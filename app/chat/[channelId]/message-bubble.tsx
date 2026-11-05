'use client'

import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { ReportMessage } from './report-message'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'
import { firstUrl } from '@/lib/links'
import { MessageAttachments } from './attachments'
import { EventCard, type CardEvent } from './event-card'
import { ContactSheet } from './contact-sheet'
import { LinkPreview } from './link-preview'
import { PollCard, type CardPoll } from './poll-card'

const QUICK = ['👍', '❤️', '✅', '❌', '❓', '😂']

/** C-03: "@Sarah Whitfield" and "@everyone" in bold, the rest as written. */
function withMentions(body: string, mine: boolean) {
  const parts = body.split(/(@everyone\b|@[A-Z][\p{L}'’-]*(?: [A-Z][\p{L}'’-]*)?)/u)
  if (parts.length === 1) return body
  return parts.map((p, i) =>
    i % 2 === 1
      ? <b key={i} className="rounded px-0.5" style={{ background: mine ? 'color-mix(in srgb, var(--ink) 12%, transparent)' : 'var(--brand-soft)', color: mine ? 'inherit' : 'var(--brand-text)' }}>{p}</b>
      : p
  )
}

/** A link in a message is a link: tappable, in the same bubble. */
function withLinks(body: string, mine: boolean) {
  const parts = body.split(/(https?:\/\/[^\s<>"')\]]+)/i)
  if (parts.length === 1) return withMentions(body, mine)
  return parts.map((p, i) => {
    if (i % 2 === 0) return <span key={i}>{withMentions(p, mine)}</span>
    // Trailing punctuation belongs to the sentence, not the link.
    const m = p.match(/^(.*?)([.,;:!?]*)$/) ?? [p, p, '']
    return (
      <span key={i}>
        <a href={m[1]} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{m[1]}</a>
        {m[2]}
      </span>
    )
  })
}

type Receipt = { read: number; total: number }

/**
 * One tick: sent. Two: some of the others have opened the channel since.
 * Two in blue: all of them have. The same fact the announcement "seen by"
 * uses (channel_members.last_read_at), so it never claims more than that.
 */
function Ticks({ receipt }: { receipt: Receipt | null }) {
  const state = !receipt || receipt.total === 0 || receipt.read === 0 ? 'sent' : receipt.read >= receipt.total ? 'all' : 'some'
  const title = !receipt || receipt.total === 0 ? 'Sent' : `Seen by ${receipt.read} of ${receipt.total}`
  return (
    <span data-ticks={state} title={title} aria-label={title} className="ml-1" style={{ color: state === 'all' ? 'var(--tick-read)' : undefined }}>
      {state === 'sent' ? '✓' : '✓✓'}
    </span>
  )
}

type Count = { emoji: string; reaction_count: number; reacted_by_me: boolean }

export function MessageBubble({
  message, mine, isHost, academyId, myId, showDay, onReply, translation = null, receipt = null, notice = null,
}: {
  message: ChatMessage
  /**
   * In a competition's Notices (0213): no reactions and no replies — who
   * reacted is names from every club — and, for the league, how many of the
   * people it was for have seen it. A count, never a name.
   */
  notice?: { reach: { seen: number; total: number } | null } | null
  /** W-08: the body in the reader's language, when they chose one and it exists. */
  translation?: string | null
  /** 0194: for my own messages, how many of the others have seen it. */
  receipt?: Receipt | null
  mine: boolean
  isHost: boolean
  academyId: string
  myId: string
  showDay: boolean
  onReply: () => void
}) {
  const [counts, setCounts] = useState<Count[]>([])
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [voters, setVoters] = useState<string | null>(null)
  const [showContact, setShowContact] = useState(false)
  const [showOriginal, setShowOriginal] = useState(false)
  const supabase = createClient()

  // Swipe right to reply, the gesture every parent already has in their
  // thumb. Horizontal only: a vertical move is the list scrolling and the
  // bubble must not follow the finger.
  const [swipeX, setSwipeX] = useState(0)
  const touch = useRef<{ x: number; y: number; dx: number; locked: boolean } | null>(null)
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, dx: 0, locked: false }
  }
  function onTouchMove(e: TouchEvent) {
    const s = touch.current
    if (!s) return
    const t = e.touches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (!s.locked) {
      if (Math.abs(dy) > 8) {
        touch.current = null
        return
      }
      if (dx < 8) return
      s.locked = true
    }
    s.dx = dx
    setSwipeX(Math.max(0, Math.min(dx, 72)))
  }
  function onTouchEnd() {
    const s = touch.current
    touch.current = null
    setSwipeX(0)
    if (s && s.dx > 56 && !message.deleted_at && !inNotices) onReply()
  }

  const inNotices = notice !== null
  useEffect(() => {
    // Nobody reacts to a notice (0213), so there is nothing to count.
    if (inNotices) return
    let cancelled = false
    supabase.rpc('reaction_counts', { p_message_ids: [message.id] }).then(({ data }) => {
      if (!cancelled) setCounts((data ?? []) as Count[])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, inNotices])

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
  // The first link in the message, previewed by the server (0194).
  const previewUrl = message.deleted_at ? null : firstUrl(message.body)
  const time = day.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

  async function saveEdit() {
    const body = (editing ?? '').trim()
    if (!body || body === message.body) return setEditing(null)
    setBusy(true)
    const supabase = createClient()
    // edited_at is stamped by a trigger, not here — see 0069. A client that
    // forgot to set it would rewrite what somebody said with no trace.
    await supabase.from('messages').update({ body }).eq('id', message.id)
    setBusy(false)
    setEditing(null)
  }

  async function remove() {
    setBusy(true)
    const supabase = createClient()
    // Soft delete: the archive trigger from 0012 depends on it, and a hard
    // delete would take every reply to this message with it.
    await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', message.id)
    setBusy(false)
  }

  return (
    <>
      {showDay && (
        <div className="my-3 text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-3">
          {dayLabel(day)}
        </div>
      )}

      <div
        className={`relative mb-2.5 flex flex-col ${mine ? 'items-end' : 'items-start'}`}
        style={{
          transform: swipeX ? `translateX(${swipeX}px)` : undefined,
          transition: swipeX ? 'none' : 'transform 160ms ease-out',
          touchAction: 'pan-y',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        data-swipe-reply
      >
        {swipeX > 20 && (
          <span aria-hidden className="absolute -left-7 top-1/2 -translate-y-1/2 text-base text-ink-3" style={{ opacity: Math.min(1, swipeX / 56) }}>
            ↩
          </span>
        )}
        {!mine && (
          <button
            onClick={() => message.sender_id && setShowContact(true)}
            className="tap mb-0.5 flex items-center gap-1.5 px-1 text-xs font-medium text-ink-2 underline-offset-2 hover:underline"
          >
            {message.sender_name ?? 'Unknown'}
            {/*
              "Leo & Zoe's dad" rather than the bare role. A team chat is
              twenty adults whose names mean nothing to each other, and the
              label is the thing that makes it a club rather than a list of
              phone numbers. Falls back to the role when there is no label —
              a coach with no children in the squad, or somebody not on the
              roster yet.
            */}
            {message.sender_label ? (
              <span className="rounded bg-[var(--surface-2)] px-1 py-px text-[0.625rem]">
                {message.sender_label}
              </span>
            ) : (
              message.sender_role &&
              message.sender_role !== 'parent' && (
                <span className="rounded bg-[var(--surface-2)] px-1 py-px text-[0.625rem] capitalize">
                  {message.sender_role}
                </span>
              )
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
          onDoubleClick={inNotices ? undefined : onReply}
          className={`${message.event || message.poll ? 'w-[85%] max-w-[85%] p-0' : 'max-w-[85%] px-3 py-2'} rounded-2xl ${
            message.is_announcement
              ? 'border-2'
              : mine
                ? 'text-ink'
                : 'border border-[var(--line)] bg-[var(--surface)]'
          }`}
          style={
            message.is_announcement
              ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--ink)' }
              : message.event || message.poll
                ? { background: 'transparent', border: 'none' }
                : mine
                  ? { background: 'var(--bubble-out)' }
                  : undefined
          }
        >
          {message.is_announcement && (
            <span className="mb-1 block text-[0.625rem] font-bold uppercase tracking-wide" style={{ color: 'var(--brand-text)' }} data-notice-label={inNotices ? message.audience ?? 'everyone' : undefined}>
              {inNotices ? (message.audience === 'club_staff' ? 'Notice · Club staff only' : 'Notice') : 'Announcement'}
            </span>
          )}

          {message.reply_to_id && (
            <div className={`mb-1.5 border-l-2 pl-2 text-xs ${mine && !message.is_announcement ? 'border-[var(--brand)]/30 text-ink-2' : 'border-[var(--line)] text-ink-2'}`}>
              <span className="font-medium">{message.reply_to_name ?? 'Someone'}</span>
              <span className="block truncate">{message.reply_to_body ?? 'Message deleted'}</span>
            </div>
          )}

          {!message.deleted_at && message.poll ? (
            <PollCard poll={message.poll as CardPoll} isHost={isHost} />
          ) : null}

          {!message.deleted_at && message.event ? (
            <EventCard
              event={message.event as CardEvent}
              academyId={academyId}
              isCoach={isHost}
            />
          ) : null}

          {!message.deleted_at && <MessageAttachments attachments={message.attachments} />}

          {message.deleted_at ? (
            <span className={`text-sm italic ${mine && !message.is_announcement ? 'text-[var(--bubble-out-ink-2)]' : 'text-ink-3'}`}>
              Message deleted
            </span>
          ) : (
            message.body &&
            (editing !== null ? (
              <span className="block">
                <textarea
                  value={editing}
                  aria-label="Edit message"
                  onChange={(e) => setEditing(e.target.value)}
                  rows={2}
                  autoFocus
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-[0.9375rem] text-ink"
                />
                <span className="mt-1 flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={busy}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-ink"
                    style={{ background: 'var(--brand)' }}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} className="px-1 text-xs text-ink-2">
                    Cancel
                  </button>
                </span>
              </span>
            ) : (
              <span className="whitespace-pre-wrap break-words text-[0.9375rem] leading-snug">
                {withLinks((translation && !showOriginal ? translation : message.body) ?? '', mine && !message.is_announcement)}
                {translation && translation !== message.body && (
                  <button onClick={() => setShowOriginal((v) => !v)} className="ml-1.5 text-[0.6875rem] underline underline-offset-2 opacity-70">
                    {showOriginal ? 'translation' : 'original'}
                  </button>
                )}
              </span>
            ))
          )}

          {previewUrl && editing === null && (
            <LinkPreview url={previewUrl} mine={mine && !message.is_announcement} />
          )}

          <span className={`mt-0.5 block text-right text-[0.625rem] tabular-nums ${mine && !message.is_announcement ? 'text-[var(--bubble-out-ink-2)]' : 'text-ink-3'}`}>
            {time}{message.edited_at && ' · edited'}
            {mine && !message.is_announcement && !message.deleted_at && <Ticks receipt={receipt} />}
          </span>
          {notice?.reach && !message.deleted_at && (
            <span className="mt-0.5 block text-right text-[0.6875rem] text-ink-3" data-notice-reach>
              Seen by {notice.reach.seen} of {notice.reach.total}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          {!inNotices && counts.map((c) => (
            <button
              key={c.emoji}
              onClick={() => react(c.emoji)}
              onContextMenu={(e) => { e.preventDefault(); whoReacted(c.emoji) }}
              className={`flex min-h-6 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs ${
                c.reacted_by_me ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--line)]'
              }`}
            >
              <span>{c.emoji}</span>
              <span className="font-semibold text-ink-2">{c.reaction_count}</span>
            </button>
          ))}

          {!inNotices && (
            <button
              onClick={() => setPicking((v) => !v)}
              className="grid min-h-8 min-w-8 place-items-center rounded-full border border-dashed border-[var(--line)] px-2 text-xs text-ink-3"
              aria-label="Add a reaction"
            >
              ＋
            </button>
          )}

          {!message.deleted_at && !inNotices && (
            <button onClick={onReply} className="tap px-1 text-xs text-ink-3">Reply</button>
          )}

          {/* Only the author may change the words. A host can take a message
              down but not put words in a parent's mouth — the database
              enforces that too, so a crafted request cannot do it either. */}
          {!message.deleted_at && mine && message.body && editing === null && (
            <button
              onClick={() => setEditing(message.body ?? '')}
              className="tap px-1 text-xs text-ink-3"
            >
              Edit
            </button>
          )}

          {/* Reporting is for somebody ELSE's message. Quiet, because most
              messages never need it and a loud Report on every bubble reads
              as an accusation waiting to happen — and findable, because
              somebody who needs it is already uncomfortable and should not
              have to hunt. */}
          {!message.deleted_at && !mine && (
            <button
              onClick={() => setReporting(true)}
              className="tap px-1 text-xs text-ink-3"
            >
              Report
            </button>
          )}

          {!message.deleted_at && (mine || isHost) && (
            <button
              onClick={() => {
                if (confirm(mine ? 'Delete this message?' : 'Remove this message for everyone?')) {
                  void remove()
                }
              }}
              disabled={busy}
              className="px-1 text-xs tap"
              style={{ color: 'var(--no)' }}
            >
              {mine ? 'Delete' : 'Remove'}
            </button>
          )}
        </div>

        {reporting && (
          <ReportMessage
            messageId={message.id}
            senderName={message.sender_name}
            onClose={() => setReporting(false)}
          />
        )}

        {picking && (
          <div className="mt-1 flex gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-1 shadow-sm">
            {QUICK.map((e) => (
              <button key={e} onClick={() => react(e)} className="px-1.5 text-lg">{e}</button>
            ))}
          </div>
        )}

        {voters && (
          <button onClick={() => setVoters(null)} className="mt-1 max-w-[85%] text-left text-xs text-ink-2">
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
