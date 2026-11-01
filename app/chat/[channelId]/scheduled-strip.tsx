'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Scheduled = { id: string; body: string | null; is_announcement: boolean; scheduled_for: string }
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * C-04: what you have queued for later, above the composer. Yours only;
 * nobody else sees a scheduled message until it goes. Cancel, or move it.
 */
export function ScheduledStrip({ channelId, refreshKey }: { channelId: string; refreshKey: number }) {
  const [rows, setRows] = useState<Scheduled[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('my_scheduled_messages', { p_channel: channelId })
    setRows((data as unknown as Scheduled[]) ?? [])
  }, [channelId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load, refreshKey])

  async function cancel(id: string) {
    setBusy(id)
    await createClient().rpc('cancel_scheduled_message', { p_message: id })
    setBusy(null)
    await load()
  }

  async function move(id: string) {
    if (!at) return
    setBusy(id)
    const { error } = await createClient().rpc('reschedule_message', { p_message: id, p_at: new Date(at).toISOString() })
    setBusy(null)
    if (!error) setEditing(null)
    await load()
  }

  if (rows.length === 0) return null
  return (
    <div className="border-t px-4 py-2 text-xs" style={{ borderColor: 'var(--line-2)', background: 'var(--surface-3)' }}>
      <span className="eyebrow">Scheduled · {rows.length}</span>
      <ul className="mt-1 space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ink">{r.is_announcement ? '📣 ' : ''}{r.body}</span>
              <span className="block text-ink-3">Goes {when(r.scheduled_for)}</span>
            </span>
            {editing === r.id ? (
              <>
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="rounded-lg border px-1.5 py-1" style={{ borderColor: 'var(--line)' }} />
                <button onClick={() => move(r.id)} disabled={busy === r.id || !at} className="rounded-lg px-2 py-1 font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Move</button>
                <button onClick={() => setEditing(null)} className="text-ink-3">×</button>
              </>
            ) : (
              <>
                <button onClick={() => { setEditing(r.id); setAt(new Date(new Date(r.scheduled_for).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)) }} className="rounded-lg border px-2 py-1" style={{ borderColor: 'var(--line)' }}>Change time</button>
                <button onClick={() => cancel(r.id)} disabled={busy === r.id} className="rounded-lg border px-2 py-1 disabled:opacity-50" style={{ borderColor: 'var(--no)', color: 'var(--no)' }}>Cancel</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
