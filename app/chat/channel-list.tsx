'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

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

type Found = {
  messages: {
    id: string
    channel_id: string
    body: string
    created_at: string
    channel_name: string | null
    sender_name: string | null
  }[]
  people: { profile_id: string; full_name: string; role: string }[]
}

export function ChannelList({ channels }: { channels: Row[] }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced, because a search box that fires on every keystroke sends nine
  // queries to Sydney to answer a five-letter word.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) {
      setFound(null)
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(() => {
      createClient()
        .rpc('search_chat', { p_query: q })
        .then(({ data }) => {
          setFound((data ?? null) as unknown as Found | null)
          setSearching(false)
        })
    }, 280)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query])

  // The three groups from the prototype. Direct messages are separated
  // because they are a different kind of thing — one person rather than a
  // room — and an ended season is separated because it is read-only and
  // should not sit among the channels people still post in.
  const active = channels.filter((c) => c.status === 'active' && c.type !== 'direct')
  const direct = channels.filter((c) => c.status === 'active' && c.type === 'direct')
  const archived = channels.filter((c) => c.status === 'archived')

  return (
    <div className="p-3.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages and people"
        type="search"
        className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-sm"
      />

      {query.trim().length >= 2 ? (
        <Results found={found} searching={searching} query={query.trim()} />
      ) : channels.length === 0 ? (
        <p className="card mt-4 p-6 text-center text-sm text-ink-3">
          No channels yet. Create a team and its channel appears automatically.
        </p>
      ) : (
        <>
          <Group title="Your channels" rows={active} />
          <Group title="Direct" rows={direct} />
          <Group title={`Archived · past seasons`} rows={archived} />
        </>
      )}
    </div>
  )
}

function Group({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mt-5">
      <h2 className="eyebrow px-1 pb-2">{title}</h2>
      <div className="card overflow-hidden">
        {rows.map((c) => (
          <ChannelRow key={c.channel_id} c={c} />
        ))}
      </div>
    </section>
  )
}

function Results({
  found,
  searching,
  query,
}: {
  found: Found | null
  searching: boolean
  query: string
}) {
  if (searching && !found) {
    return <p className="mt-6 text-center text-sm text-ink-3">Searching…</p>
  }
  const messages = found?.messages ?? []
  const people = found?.people ?? []

  if (messages.length === 0 && people.length === 0) {
    return (
      <p className="card mt-4 p-6 text-center text-sm text-ink-3">
        Nothing matching “{query}”.
      </p>
    )
  }

  return (
    <>
      {people.length > 0 && (
        <section className="mt-5">
          <h2 className="eyebrow px-1 pb-2">People</h2>
          <div className="card overflow-hidden">
            {people.map((p) => (
              <div key={p.profile_id} className="row">
                <span className="av alt">{initials(p.full_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.full_name}</span>
                  <span className="badge">{p.role}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {messages.length > 0 && (
        <section className="mt-5">
          <h2 className="eyebrow px-1 pb-2">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </h2>
          <div className="card overflow-hidden">
            {messages.map((m) => (
              <Link key={m.id} href={`/chat/${m.channel_id}`} className="row items-start">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {m.channel_name ?? 'Direct message'}
                    </span>
                    <span className="flex-none text-xs text-ink-3">{shortTime(m.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-2">
                    {m.sender_name ? <b className="font-medium">{m.sender_name.split(' ')[0]}: </b> : null}
                    <Highlight text={m.body} term={query} />
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/**
 * Shows the match in context rather than the start of the message.
 *
 * A search result that always begins at the first word is useless for the
 * thing people actually search a team chat for: a detail buried in the
 * middle of a long message about something else.
 */
function Highlight({ text, term }: { text: string; term: string }) {
  const at = text.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return <>{text.slice(0, 90)}</>

  const from = Math.max(0, at - 28)
  const before = (from > 0 ? '…' : '') + text.slice(from, at)
  const hit = text.slice(at, at + term.length)
  const after = text.slice(at + term.length, at + term.length + 50)

  return (
    <>
      {before}
      <mark style={{ background: 'var(--gold)', color: 'var(--ink)', borderRadius: 3, padding: '0 2px' }}>
        {hit}
      </mark>
      {after}
      {text.length > at + term.length + 50 ? '…' : ''}
    </>
  )
}

function ChannelRow({ c }: { c: Row }) {
  return (
    <Link href={`/chat/${c.channel_id}`} className="chan active:bg-[var(--surface-3)]">
      <span
        className={`av ${c.status === 'archived' || c.unread_count === 0 ? 'alt' : ''}`}
      >
        {initials(c.name ?? '··')}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{c.name ?? 'Direct message'}</span>
          {c.muted && <span className="badge">muted</span>}
        </span>
        <span className="block truncate text-xs text-ink-2">
          {c.last_message_body
            ? `${c.last_sender_name ? c.last_sender_name.split(' ')[0] + ': ' : ''}${c.last_message_body}`
            : c.status === 'archived'
              ? 'Read-only · season ended'
              : 'No messages yet'}
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
            className="grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold"
            style={{
              background: c.muted ? 'var(--ink-3)' : 'var(--accent)',
              // --accent-ink, not white. In dark the accent is a light
              // orange so it reads on a dark ground, which left white on it
              // at 2.59:1 — the count was the least readable text here. The
              // muted badge keeps white, which --ink-3 carries at 5:1.
              color: c.muted ? '#fff' : 'var(--accent-ink)',
            }}
          >
            {c.unread_count > 99 ? '99+' : c.unread_count}
          </span>
        )}
      </span>
    </Link>
  )
}

function initials(name: string) {
  return (
    name
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '··'
  )
}

function shortTime(iso: string) {
  const d = new Date(iso)
  const days = (Date.now() - d.getTime()) / 864e5
  if (days < 1) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return d.toLocaleDateString('en-AU', { weekday: 'short' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
