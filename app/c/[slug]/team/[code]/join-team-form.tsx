'use client'

import { useState } from 'react'

export type CaptainTeam = {
  competition: string
  season: string | null
  organiser: string
  team_name: string
  division: string | null
  squad_size: number | null
  members: number
  open: boolean
  pay_mode: 'split' | 'captain' | null
  fee_cents: number | null
  share_cents: number | null
  has_captain: boolean
}
type Joined = { captain: boolean; share_cents: number | null; join_code: string | null; members: number; squad_size: number | null; email: string | null; newAccount: boolean }

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function JoinTeamForm({ slug, code, team }: { slug: string; code: string; team: CaptainTeam }) {
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', dob: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<Joined | null>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/competitions/join-team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...form }) })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(body.error ?? 'Could not join.')
    setJoined(body as Joined)
  }

  const field = 'mt-1 w-full rounded-xl border px-3 py-2.5 text-base'
  const link = typeof window !== 'undefined' ? `${window.location.origin}/c/${slug}/team/${code}` : `/c/${slug}/team/${code}`
  return (
    <main className="mx-auto w-full max-w-lg pb-12" data-join-team={code}>
      <header className="px-5 pb-5 pt-7" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
        <p className="eyebrow" style={{ color: '#ffffffaa' }}>{team.competition}{team.season ? ` · ${team.season}` : ''} · {team.organiser}</p>
        <h1 className="display mt-1 text-[1.875rem] leading-none">{team.team_name}</h1>
        <p className="mt-1.5 text-sm" style={{ color: '#ffffffb3' }}>
          {team.squad_size ? `${team.members} of ${team.squad_size} in` : `${team.members} in`}{team.division ? ` · ${team.division}` : ''}
        </p>
      </header>

      {joined ? (
        <div className="p-5" data-joined={joined.captain ? 'captain' : 'player'}>
          <div className="card p-5 text-sm">
            <p className="display text-[1.375rem] leading-tight">You&apos;re on {team.team_name}</p>
            {joined.captain ? (
              <>
                <p className="mt-2 text-ink-2">You&apos;re the captain. Share the code with the team — each of them lands here, gives a name and a mobile, and is in.</p>
                <p className="mt-3 rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)' }}>
                  <span className="display block text-[1.75rem] tracking-[0.2em]" data-join-code>{joined.join_code}</span>
                  <span className="block break-all text-xs text-ink-3">{link}</span>
                </p>
              </>
            ) : (
              <p className="mt-2 text-ink-2">{joined.members}{joined.squad_size ? ` of ${joined.squad_size}` : ''} in now.</p>
            )}
            {joined.share_cents != null && <p className="mt-3 text-ink-2">Your share of the entry fee is <b>{money(joined.share_cents)}</b> — pay it in the app under Your payments.</p>}
            {team.pay_mode === 'captain' && team.fee_cents != null && joined.captain && (
              <p className="mt-3 text-ink-2">The entry fee is <b>{money(team.fee_cents)}</b>, paid to {team.organiser} — they will tell you how.</p>
            )}
            <p className="mt-3 text-ink-2">
              To see the squad and the draw, sign in{joined.email ? ` with ${joined.email}` : ' with your mobile'} — a link comes by {joined.email ? 'email' : 'text'}, no password.
            </p>
            <a href="/signin" className="mt-4 block w-full rounded-xl px-4 py-3 text-center text-sm font-semibold text-brand-ink" style={{ background: 'var(--brand)' }}>Sign in</a>
          </div>
        </div>
      ) : !team.open ? (
        <div className="p-5">
          <p className="card p-5 text-center text-sm"><b>The team is full</b> — {team.squad_size} players. Ask your captain.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="p-5">
          <p className="text-sm text-ink-2">
            Adults only — under-18s play through a club.{team.share_cents != null ? ` Each player pays their share of the entry fee, ${money(team.share_cents)}, in the app.` : team.pay_mode === 'captain' ? ' The captain pays the entry fee.' : ''}
          </p>
          <label className="mt-4 block text-sm">
            Your name
            <input value={form.fullName} onChange={set('fullName')} required autoComplete="name" className={field} style={{ borderColor: 'var(--line)' }} data-join-team-name />
          </label>
          <label className="mt-3 block text-sm">
            Mobile
            <input value={form.phone} onChange={set('phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="0412 345 678" className={field} style={{ borderColor: 'var(--line)' }} data-join-team-phone />
          </label>
          <label className="mt-3 block text-sm">
            Email <span className="text-ink-3">(for signing in)</span>
            <input value={form.email} onChange={set('email')} type="email" inputMode="email" autoComplete="email" className={field} style={{ borderColor: 'var(--line)' }} data-join-team-email />
          </label>
          <label className="mt-3 block text-sm">
            Date of birth
            <input value={form.dob} onChange={set('dob')} required type="date" className={field} style={{ borderColor: 'var(--line)' }} data-join-team-dob />
          </label>
          {error && <p className="mt-4 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-join-team-send>
            {busy ? 'Joining…' : `Join ${team.team_name}`}
          </button>
          <p className="mt-3 text-center text-xs text-ink-3">Only your team and the organiser see these details.</p>
        </form>
      )}
    </main>
  )
}
