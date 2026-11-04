'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Reply = { id: string; body: string; from_staff: boolean; at: string; name: string | null }
type Thread = { id: string; subject: string; body: string; status: 'open' | 'answered' | 'closed'; created_at: string; updated_at: string; replies: Reply[] }

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * G-03: a person writes to Squadroom from inside the app; Squadroom writes
 * back and the person is pushed. Their own threads only. The status page
 * is one tap away for "is it just me?".
 */
export function HelpScreen() {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('support_threads', { p_inbox: false })
    setThreads(error ? [] : ((data as unknown as Thread[]) ?? []))
  }, [])
  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function send() {
    setBusy('send')
    setError(null)
    const { error } = await createClient().rpc('open_support_request', { p_subject: subject.trim(), p_body: body.trim(), p_academy: getOrg() ?? undefined })
    setBusy(null)
    if (error) return setError(error.message)
    setSubject('')
    setBody('')
    setSent(true)
    await load()
  }
  async function answer(id: string) {
    setBusy(id)
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

  const line = { borderColor: 'var(--line)' }
  return (
    <div className="p-3.5" data-help>
      <section className="card p-3.5">
        <h2 className="eyebrow pb-1.5">Ask Squadroom</h2>
        <p className="text-sm text-ink-2">A person reads this, not a bot. You get a push when we reply.</p>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is it about?" className="mt-3 w-full rounded-lg border px-3 py-2 text-sm" style={line} data-help-subject />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="What happened, what you expected, and the squad or game if there is one." className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" style={line} data-help-body />
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
        {sent && <p className="mt-2 text-xs" style={{ color: 'var(--yes)' }}>Sent. We will come back to you here.</p>}
        <button onClick={send} disabled={busy !== null || !subject.trim() || !body.trim()} className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-help-send>
          {busy === 'send' ? 'Sending…' : 'Send to Squadroom'}
        </button>
        <p className="mt-2 text-xs text-ink-3">
          Something not working for everyone? <Link href="/status" className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>Check the status page</Link>.
        </p>
      </section>

      {threads && threads.length > 0 && (
        <section className="mt-4">
          <h2 className="eyebrow pb-1.5">Your requests</h2>
          <div className="stack">
            {threads.map((t) => (
              <article key={t.id} className="card p-3" data-thread={t.id} data-status={t.status}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{t.subject}</p>
                    <p className="text-xs text-ink-3">{when(t.created_at)}</p>
                  </div>
                  <span className="pill flex-none" style={t.status === 'answered' ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>
                    {t.status === 'answered' ? 'Replied' : t.status === 'closed' ? 'Closed' : 'Open'}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{t.body}</p>
                {t.replies.map((r) => (
                  <p key={r.id} className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: r.from_staff ? 'var(--brand-soft)' : 'var(--surface-2)' }} data-reply={r.from_staff ? 'staff' : 'me'}>
                    <span className="block text-[0.6875rem] text-ink-3">{r.name ?? 'You'} · {when(r.at)}</span>
                    {r.body}
                  </p>
                ))}
                {t.status !== 'closed' && (
                  <div className="mt-2 flex gap-2">
                    <input value={reply[t.id] ?? ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} placeholder="Reply…" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={line} />
                    <button onClick={() => answer(t.id)} disabled={busy !== null || !(reply[t.id] ?? '').trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>Send</button>
                    <button onClick={() => close(t.id)} disabled={busy !== null} className="rounded-lg border px-2 py-1.5 text-xs" style={line}>Done</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
