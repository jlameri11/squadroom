'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Pending = {
  id: string
  body: string | null
  sender_name: string | null
  created_at: string
}

/**
 * Messages held for a host's approval.
 *
 * Only rendered for hosts, but that is presentation: the function behind it
 * returns nothing to anyone else, and a parent cannot publish their own
 * message even by calling the API directly.
 */
export function PendingQueue({ channelId, isHost }: { channelId: string; isHost: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<Pending[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    if (!isHost) return
    let cancelled = false
    supabase.rpc('pending_messages', { p_channel: channelId }).then(({ data }) => {
      if (!cancelled) setItems((data ?? []) as Pending[])
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, isHost])

  async function decide(id: string, status: 'published' | 'rejected') {
    setBusy(id)
    await supabase.from('messages').update({ status }).eq('id', id)
    setItems((prev) => prev.filter((m) => m.id !== id))
    setBusy(null)
    if (status === 'published') router.refresh()
  }

  if (!isHost || items.length === 0) return null

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        Waiting for you · {items.length}
      </p>
      <div className="mt-1.5 flex flex-col gap-2">
        {items.map((m) => (
          <div key={m.id} className="rounded-lg border border-amber-200 bg-white p-2">
            <p className="text-xs text-neutral-500">{m.sender_name ?? 'Someone'}</p>
            <p className="text-sm">{m.body}</p>
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => decide(m.id, 'published')}
                disabled={busy === m.id}
                className="rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: '#202842' }}
              >
                Approve
              </button>
              <button
                onClick={() => decide(m.id, 'rejected')}
                disabled={busy === m.id}
                className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
