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
      <p className="m-5 rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
        No channels yet. Create a team and its channel appears automatically.
      </p>
    )
  }

  return (
    <div>
      {active.map((c) => <ChannelRow key={c.channel_id} c={c} />)}

      {archived.length > 0 && (
        <>
          <h2 className="px-5 pb-1 pt-6 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Past seasons
          </h2>
          {archived.map((c) => <ChannelRow key={c.channel_id} c={c} />)}
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
      className="flex items-center gap-3 border-b border-neutral-100 px-5 py-3.5 active:bg-neutral-50"
    >
      <span
        className="grid h-11 w-11 flex-none place-items-center rounded-xl text-sm font-bold text-white"
        style={{ background: c.status === 'archived' ? '#9CA3AF' : '#202842' }}
      >
        {initials}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{c.name ?? 'Direct message'}</span>
          {c.muted && <span className="text-xs text-neutral-400">muted</span>}
        </span>
        <span className="block truncate text-sm text-neutral-500">
          {c.last_message_body
            ? `${c.last_sender_name ? c.last_sender_name.split(' ')[0] + ': ' : ''}${c.last_message_body}`
            : c.last_message_at
              ? 'Message deleted'
              : c.status === 'archived' ? 'Read-only' : 'No messages yet'}
        </span>
      </span>

      <span className="flex flex-none flex-col items-end gap-1.5">
        {c.last_message_at && (
          <span className="text-xs text-neutral-400">{shortTime(c.last_message_at)}</span>
        )}
        {c.unread_count > 0 && (
          // Muted still counts. Muting says "don't buzz me", not "hide this
          // from me" — a parent who muted the U10s still wants to know there
          // are fourteen messages waiting.
          <span
            className="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold text-white"
            style={{ background: c.muted ? '#9CA3AF' : '#DD5620' }}
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
