'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Msg = { id: string; body: string; pinned: boolean; relevant_until: string | null; urgent: boolean; created_at: string; sender_name: string; seen_at: string | null }

export function ClubMessages({ openId }: { openId?: string }) {
  const org = useCurrentOrg()
  const [list, setList] = useState<Msg[] | null>(null)
  const [open, setOpen] = useState<string | null>(openId ?? null)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const supabase = createClient()
      // Arriving from a push on one message is reading it: mark it before
      // the list is read, so the list already says so.
      if (openId) await supabase.rpc('mark_club_message_seen', { p_message: openId })
      const { data } = await supabase.rpc('my_club_messages', { p_academy: org.id })
      if (live) setList((data as unknown as Msg[] | null) ?? [])
    })()
    return () => {
      live = false
    }
  }, [org, openId])

  // Opening one is reading it: the sender's "Seen by" counts it from here.
  function toggle(id: string) {
    const next = open === id ? null : id
    setOpen(next)
    if (!next) return
    // A builder sends nothing until it is awaited or then'd.
    void createClient().rpc('mark_club_message_seen', { p_message: next }).then(() => undefined)
    setList((l) => (l ? l.map((m) => (m.id === next && !m.seen_at ? { ...m, seen_at: new Date().toISOString() } : m)) : l))
  }

  if (!org || list === null) return <ScreenSkeleton />
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

  return (
    <div className="p-4" data-club-messages={list.length}>
      {list.length === 0 ? (
        <p className="card p-5 text-center text-sm text-ink-2">Nothing from the club yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => {
            const isOpen = open === m.id
            return (
              <li key={m.id} className="card p-3.5" style={m.urgent ? { borderColor: 'var(--accent)' } : undefined} data-club-message={m.id} data-seen={m.seen_at ? 'yes' : 'no'}>
                <button onClick={() => toggle(m.id)} className="block w-full text-left" aria-expanded={isOpen}>
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    {m.pinned && <span className="pill">pinned</span>}
                    {m.urgent && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>urgent</span>}
                    {!m.seen_at && <span className="h-2 w-2 flex-none rounded-full" style={{ background: 'var(--accent)' }} aria-label="unread" />}
                    <span>{m.sender_name} · {when(m.created_at)}</span>
                  </span>
                  <span className={`mt-1 block text-sm ${isOpen ? '' : 'line-clamp-3'}`}>{m.body}</span>
                  {m.relevant_until && <span className="mt-1 block text-xs text-ink-3">Until {new Date(m.relevant_until).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
