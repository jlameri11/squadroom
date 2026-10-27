'use client'

import { useEffect, useState } from 'react'
import { ReportMessage } from './report-message'
import { createClient } from '@/lib/supabase/client'
import type { ChatMessage } from '@/lib/hooks/use-channel-messages'
import { MessageAttachments } from './attachments'
import { EventCard, type CardEvent } from './event-card'
import { ContactSheet } from './contact-sheet'
import { PollCard, type CardPoll } from './poll-card'

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
  const [editing, setEditing] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const [busy, setBusy] = useState(false)
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
        <div className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          {dayLabel(day)}
        </div>
      )}

      <div className={`mb-2.5 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {!mine && (
          <button
            onClick={() => message.sender_id && setShowContact(true)}
            className="mb-0.5 flex items-center gap-1.5 px-1 text-xs font-medium text-ink-2 underline-offset-2 hover:underline"
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
              <span className="rounded bg-[var(--surface-2)] px-1 py-px text-[10px]">
                {message.sender_label}
              </span>
            ) : (
              message.sender_role &&
              message.sender_role !== 'parent' && (
                <span className="rounded bg-[var(--surface-2)] px-1 py-px text-[10px] capitalize">
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
          onDoubleClick={onReply}
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
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--brand)' }}>
              Announcement
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
            <span className={`text-sm italic ${mine && !message.is_announcement ? 'text-white/60' : 'text-ink-3'}`}>
              Message deleted
            </span>
          ) : (
            message.body &&
            (editing !== null ? (
              <span className="block">
                <textarea
                  value={editing}
                  onChange={(e) => setEditing(e.target.value)}
                  rows={2}
                  autoFocus
                  className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 text-[15px] text-ink"
                />
                <span className="mt-1 flex gap-2">
                  <button
                    onClick={saveEdit}
                    disabled={busy}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
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
              <span className="whitespace-pre-wrap break-words text-[15px] leading-snug">{message.body}</span>
            ))
          )}

          <span className={`mt-0.5 block text-right text-[10px] tabular-nums ${mine && !message.is_announcement ? 'text-white/60' : 'text-ink-3'}`}>
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
                c.reacted_by_me ? 'border-[var(--brand)] bg-[var(--surface-2)]' : 'border-[var(--line)]'
              }`}
            >
              <span>{c.emoji}</span>
              <span className="font-semibold text-ink-2">{c.reaction_count}</span>
            </button>
          ))}

          <button
            onClick={() => setPicking((v) => !v)}
            className="rounded-full border border-dashed border-[var(--line)] px-1.5 py-0.5 text-xs text-ink-3"
            aria-label="Add a reaction"
          >
            ＋
          </button>

          {!message.deleted_at && (
            <button onClick={onReply} className="px-1 text-xs text-ink-3">Reply</button>
          )}

          {/* Only the author may change the words. A host can take a message
              down but not put words in a parent's mouth — the database
              enforces that too, so a crafted request cannot do it either. */}
          {!message.deleted_at && mine && message.body && editing === null && (
            <button
              onClick={() => setEditing(message.body ?? '')}
              className="px-1 text-xs text-ink-3"
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
              className="px-1 text-xs text-ink-3"
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
              className="px-1 text-xs"
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
