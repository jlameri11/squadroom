'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Stage = 'form' | 'pending' | 'done'

/**
 * Name, number, children. No password, no code.
 *
 * The secret we get back is kept in localStorage: it is what proves, later,
 * that this browser is the one the coach approved.
 */
export function JoinForm({
  token,
  academyName,
  teamName,
}: {
  token: string
  academyName: string
  teamName: string | null
}) {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('form')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [children, setChildren] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const res = await fetch('/api/join/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        fullName,
        phone,
        children: children.split(',').map((c) => c.trim()).filter(Boolean),
      }),
    })
    const data = await res.json()
    setBusy(false)

    if (!res.ok) return setError(data.error ?? 'Something went wrong.')

    localStorage.setItem('squadroom.join', JSON.stringify({ requestId: data.requestId, secret: data.secret }))
    setStage('pending')
  }

  async function checkApproval() {
    setBusy(true)
    setError(null)
    const stored = localStorage.getItem('squadroom.join')
    if (!stored) { setBusy(false); return setError('Start again — this browser lost the request.') }

    const res = await fetch('/api/join/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.parse(stored)),
    })
    setBusy(false)

    if (res.status === 202) return setError('Not yet — your coach hasn’t approved it.')
    if (!res.ok) return setError('That didn’t work. Ask your coach to check.')

    localStorage.removeItem('squadroom.join')
    setStage('done')
    // The session cookies were set by the server during the claim, so the
    // refresh is what makes the server re-render as the signed-in parent.
    router.replace('/')
    router.refresh()
  }

  if (stage === 'pending') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">Waiting for your coach</h1>
        <p className="text-sm text-ink-2">
          They&apos;ll see that you asked to join {teamName ?? academyName} and tap approve. You can
          close this — come back any time.
        </p>
        {error && <p className="text-sm ">{error}</p>}
        <button
          onClick={checkApproval}
          disabled={busy}
          className="rounded-xl bg-[var(--brand)] px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Join {teamName ?? academyName}</h1>
        <p className="mt-1 text-sm text-ink-2">{academyName}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Your name</span>
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3"
            autoComplete="name"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Mobile</span>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0412 345 678"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            Your children in this team
          </span>
          <input
            value={children}
            onChange={(e) => setChildren(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3"
            placeholder="Leo Whitfield, Zoe Whitfield"
          />
        </label>

        {error && <p className="text-sm ">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-[var(--brand)] px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Request to join'}
        </button>
        <p className="text-center text-xs text-ink-2">
          No password. No verification code. Your coach approves you.
        </p>
      </form>
    </main>
  )
}
