'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { checkEmail } from '@/lib/email'

type Mine = { email: string | null; verified: boolean; news: boolean; needs_email: boolean }

const ARRIVED: Record<string, string> = {
  confirmed: 'Thanks — your email is confirmed.',
  'already-confirmed': 'That link was used already. Your email is confirmed.',
  'link-expired': 'That link has expired. Send a new one below.',
  'link-broken': 'That link didn’t work. Send a new one below.',
  'address-changed': 'That link was for an address you have since changed. Send a new one below.',
}

/**
 * Your email (0214): the address, whether it is confirmed, a new link, a
 * change, and the news-and-offers box — off unless ticked, and only ever
 * what you ticked. Hidden until 0214 exists.
 */
export function YourEmail() {
  const params = useSearchParams()
  const [mine, setMine] = useState<Mine | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(ARRIVED[params.get('email') ?? ''] ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('my_email')
      if (live && !error && data) setMine(data as unknown as Mine)
    })()
    return () => {
      live = false
    }
  }, [])

  if (!mine) return null

  async function save() {
    const check = checkEmail(draft)
    if (!check.ok) return setError(check.error)
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('set_my_email', { p_email: check.email })
    if (error) {
      setBusy(false)
      return setError(error.message)
    }
    const next = data as unknown as Mine
    setMine(next)
    setEditing(false)
    if (!next.verified) await sendLink()
    setBusy(false)
  }

  async function sendLink() {
    const res = await fetch('/api/email/confirm', { method: 'POST' }).catch(() => null)
    const json = (await res?.json().catch(() => null)) as { sent?: boolean; email?: string } | null
    setNote(json?.sent ? `We sent a link to ${mine?.email ?? 'your email'}. Tap it to confirm.` : json?.email === 'off' ? 'Saved. You’ll be asked to confirm it soon.' : 'Saved.')
  }

  async function setNews(next: boolean) {
    setBusy(true)
    setError(null)
    const { data, error } = await createClient().rpc('set_my_news', { p_news: next })
    setBusy(false)
    if (error) return setError(error.message)
    setMine(data as unknown as Mine)
  }

  return (
    <section className="mt-6" data-your-email>
      <h2 className="eyebrow">Your email</h2>
      <div className="card mt-2 p-4">
        {!editing ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 break-all text-sm font-medium">{mine.email ?? 'None yet'}</span>
            {mine.email && (
              <span className="pill text-xs" style={mine.verified ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }} data-email-state={mine.verified ? 'confirmed' : 'unconfirmed'}>
                {mine.verified ? 'Confirmed' : 'Not confirmed yet'}
              </span>
            )}
            <button onClick={() => { setDraft(mine.email ?? ''); setEditing(true); setNote(null) }} className="tap text-sm underline underline-offset-2">
              {mine.email ? 'Change' : 'Add'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode="email"
              autoComplete="email"
              aria-label="Your email"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--line)' }}
            />
            <button onClick={save} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
              Save
            </button>
            <button onClick={() => setEditing(false)} className="tap text-sm text-ink-2">Cancel</button>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-3">
          For your club and your league to reach you. Any email you read — it doesn&apos;t have to match
          PlayFootball. Your club&apos;s owners and admins can see it; nobody else can.
        </p>
        {mine.email && !mine.verified && !editing && (
          <button onClick={() => void sendLink()} className="tap mt-1 text-xs underline underline-offset-2" style={{ color: 'var(--brand-text)' }}>
            Send the confirmation link again
          </button>
        )}
        {note && <p className="mt-2 text-xs text-ink-2" role="status">{note}</p>}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
        {mine.email && (
          <label className="mt-3 flex items-start gap-2.5 border-t pt-3 text-sm text-ink-2" style={{ borderColor: 'var(--line-2)' }}>
            <input
              type="checkbox"
              checked={mine.news}
              disabled={busy}
              onChange={(e) => void setNews(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-none"
              data-news-opt-in
            />
            <span>Send me news and offers from Squadroom <span className="text-ink-3">(optional — club and league notices come either way)</span></span>
          </label>
        )}
      </div>
    </section>
  )
}
