'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Reply = { id: string; body: string; from_staff: boolean; at: string; name: string | null }
type Thread = { id: string; subject: string; body: string; status: 'open' | 'answered' | 'closed'; created_at: string; updated_at: string; from: { name: string; academy: string | null } | null; replies: Reply[] }
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** G-03: the platform admins' inbox, and the status notices they post. */
export function SupportInbox() {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [reply, setReply] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState({ kind: 'notice', title: '', body: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('support_threads', { p_inbox: true })
    setThreads(error ? [] : ((data as unknown as Thread[]) ?? []))
  }, [])
  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function answer(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('reply_support', { p_request: id, p_body: (reply[id] ?? '').trim() })
    setBusy(null)
    if (error) return setError(error.message)
    setReply({ ...reply, [id]: '' })
    await load()
  }
  async function close(id: string) {
    setBusy(id)
    await createClient().rpc('close_support_request', { p_request: id })
    setBusy(null)
    await load()
  }
  async function postNotice() {
    setBusy('notice')
    setError(null)
    const { error } = await createClient().from('platform_status').insert({ kind: notice.kind, title: notice.title.trim(), body: notice.body.trim() || null })
    setBusy(null)
    if (error) return setError(error.message)
    setNotice({ kind: 'notice', title: '', body: '' })
  }

  if (!threads) return null
  const shown = threads.filter((t) => showClosed || t.status !== 'closed')
  const line = { borderColor: 'var(--line)' }
  return (
    <section className="mt-7" id="support" data-support-inbox>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Support · {threads.filter((t) => t.status === 'open').length} waiting</h2>
        <label className="flex items-center gap-1.5 text-xs text-ink-3"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show closed</label>
      </div>
      {shown.length === 0 && <p className="mt-2 text-sm text-ink-3">Nothing waiting.</p>}
      <div className="mt-2 flex flex-col gap-2">
        {shown.map((t) => (
          <article key={t.id} className="rounded-xl border p-3" style={line} data-inbox-thread={t.id} data-status={t.status}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{t.subject}</p>
                <p className="text-xs text-ink-3">{t.from?.name ?? 'Someone'}{t.from?.academy ? ` · ${t.from.academy}` : ''} · {when(t.created_at)}</p>
              </div>
              <span className="pill flex-none">{t.status}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{t.body}</p>
            {t.replies.map((r) => (
              <p key={r.id} className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: r.from_staff ? 'var(--brand-soft)' : 'var(--surface-2)' }}>
                <span className="block text-[11px] text-ink-3">{r.name ?? '?'} · {when(r.at)}</span>
                {r.body}
              </p>
            ))}
            {t.status !== 'closed' && (
              <div className="mt-2 flex gap-2">
                <input value={reply[t.id] ?? ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} placeholder="Reply as Squadroom…" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={line} data-inbox-reply />
                <button onClick={() => answer(t.id)} disabled={busy !== null || !(reply[t.id] ?? '').trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-inbox-send>Send</button>
                <button onClick={() => close(t.id)} disabled={busy !== null} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>Close</button>
              </div>
            )}
          </article>
        ))}
      </div>

      <h2 className="mt-7 text-xs font-semibold uppercase tracking-wide text-ink-2">Status page notice</h2>
      <div className="mt-2 rounded-xl border p-3" style={line}>
        <div className="flex gap-2">
          <select value={notice.kind} onChange={(e) => setNotice({ ...notice, kind: e.target.value })} className="rounded-lg border px-2 py-1.5 text-sm" style={line} aria-label="Kind">
            <option value="notice">Notice</option>
            <option value="incident">Incident</option>
            <option value="resolved">Resolved</option>
          </select>
          <input value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} placeholder="Title" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={line} />
        </div>
        <textarea value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} rows={2} placeholder="What people will see on /status" className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} />
        <button onClick={postNotice} disabled={busy !== null || !notice.title.trim()} className="mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }}>Post to the status page</button>
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>
    </section>
  )
}
