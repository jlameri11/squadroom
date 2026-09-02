'use client'

import Link from 'next/link'

type Row = {
  channel_id: string
  name: string | null
  type: string
  status: string
  muted: boolean
  unread_count: number
  last_message_at: string | null
  last_message_body: string | null
  last_sender_name: string | null
}

export function ChannelList({ channels }: { channels: Row[] }) {
  const active = channels.filter((c) => c.status === 'active')
  const archived = channels.filter((c) => c.status === 'archived')

  if (channels.length === 0) {
    return (
      <p className="m-4 card p-6 text-center text-sm text-ink-3">
        No channels yet. Create a team and its channel appears automatically.
      </p>
    )
  }

  return (
    <div className="p-4">
      <div className="card overflow-hidden">
        {active.map((c) => <ChannelRow key={c.channel_id} c={c} />)}
      </div>

      {archived.length > 0 && (
        <>
          <h2 className="eyebrow px-1 pb-2 pt-6">Past seasons</h2>
          <div className="card overflow-hidden">
            {archived.map((c) => <ChannelRow key={c.channel_id} c={c} />)}
          </div>
        </>
      )}
    </div>
  )
}

function ChannelRow({ c }: { c: Row }) {
  const initials = (c.name ?? '··').replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '··'

  return (
    <Link
      href={`/chat/${c.channel_id}`}
      className="row active:bg-[var(--surface-3)]"
    >
      <span
        className="display grid h-11 w-11 flex-none place-items-center rounded-xl text-[15px] text-white"
        style={{ background: c.status === 'archived' ? 'var(--ink-3)' : 'var(--brand)' }}
      >
        {initials}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{c.name ?? 'Direct message'}</span>
          {c.muted && <span className="tag">muted</span>}
        </span>
        <span className="block truncate text-sm text-ink-3">
          {c.last_message_body
            ? `${c.last_sender_name ? c.last_sender_name.split(' ')[0] + ': ' : ''}${c.last_message_body}`
            : c.last_message_at
              ? 'Message deleted'
              : c.status === 'archived' ? 'Read-only' : 'No messages yet'}
        </span>
      </span>

      <span className="flex flex-none flex-col items-end gap-1.5">
        {c.last_message_at && (
          <span className="text-xs text-ink-3">{shortTime(c.last_message_at)}</span>
        )}
        {c.unread_count > 0 && (
          // Muted still counts. Muting says "don't buzz me", not "hide this
          // from me" — a parent who muted the U10s still wants to know there
          // are fourteen messages waiting.
          <span
            className="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold text-white"
            style={{ background: c.muted ? 'var(--ink-3)' : 'var(--accent)' }}
          >
            {c.unread_count > 99 ? '99+' : c.unread_count}
          </span>
        )}
      </span>
    </Link>
  )
}

function shortTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((now.getTime() - d.getTime()) / 86400000)
  if (days < 7) return d.toLocaleDateString('en-AU', { weekday: 'short' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
