'use client'

import { useState } from 'react'

export type EntryInfo = {
  name: string
  season: string | null
  organiser: string
  divisions: { division: string; fee_cents: number | null }[]
  fee_cents: number | null
  instructions: string | null
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function EnterForm({ slug, info, teamCreator = false }: { slug: string; info: EntryInfo; teamCreator?: boolean }) {
  const [form, setForm] = useState({ clubName: '', teamName: '', division: info.divisions[0]?.division ?? '', contactName: '', contactPhone: '', contactEmail: '', note: '' })
  // 0261: a captain entering a team of their own — no club, a squad size, who pays.
  const [captain, setCaptain] = useState(false)
  const [squadSize, setSquadSize] = useState('8')
  const [payMode, setPayMode] = useState<'split' | 'captain'>('split')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })
  const fee = info.divisions.find((d) => d.division === form.division)?.fee_cents ?? info.fee_cents
  const share = captain && fee != null && Number(squadSize) >= 5 ? Math.ceil(fee / Number(squadSize)) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch('/api/competitions/enter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...form, ...(captain ? { captain: true, squadSize: Number(squadSize), payMode } : {}) }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setError(body.error ?? 'Could not send that.')
    setSent(true)
  }

  const field = 'mt-1 w-full rounded-xl border px-3 py-2.5 text-base'
  return (
    <main className="mx-auto w-full max-w-lg pb-12">
      <header className="px-5 pb-5 pt-7" style={{ background: 'var(--bar)', color: 'var(--bar-ink)' }}>
        <p className="eyebrow" style={{ color: '#ffffffaa' }}>{info.organiser}</p>
        <h1 className="display mt-1 text-[1.875rem] leading-none">{info.name}</h1>
        <p className="mt-1.5 text-sm" style={{ color: '#ffffffb3' }}>Enter a team{info.season ? ` · ${info.season}` : ''}</p>
      </header>

      {sent ? (
        <div className="p-5">
          <p className="card p-5 text-center text-sm">
            <b>Sent.</b> {info.organiser} will look at the entry and send {form.contactName.split(' ')[0] || 'you'} {captain ? 'the team’s code to share' : 'a link to join the competition'}.
            {fee != null && fee > 0 ? ` The entry fee is ${money(fee)}, paid to ${info.organiser} once accepted.` : ''}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="p-5">
          <p className="text-sm text-ink-2">
            No account needed. The organiser decides, then sends a link so your club can see the draw, enter scores and submit team sheets.
          </p>
          {teamCreator && (
            <label className="mt-4 flex items-start gap-2.5 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--line)' }}>
              <input type="checkbox" checked={captain} onChange={(e) => setCaptain(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none" data-enter-captain />
              <span>
                <span className="block font-medium">I&apos;m a captain entering my own team</span>
                <span className="block text-xs text-ink-3">No club. Once accepted you get a code; your teammates join with it and pay their share, or you pay the organiser.</span>
              </span>
            </label>
          )}
          <section className="mt-4">
            <span className="eyebrow">The team</span>
            {!captain && (
              <label className="mt-2 block text-sm">
                Club
                <input value={form.clubName} onChange={set('clubName')} required className={field} style={{ borderColor: 'var(--line)' }} />
              </label>
            )}
            <label className="mt-3 block text-sm">
              Team name
              <input value={form.teamName} onChange={set('teamName')} required placeholder="e.g. Hills Hawks U10 Red" className={field} style={{ borderColor: 'var(--line)' }} />
            </label>
            {info.divisions.length > 0 && (
              <label className="mt-3 block text-sm">
                Division
                <select value={form.division} onChange={set('division')} className={field} style={{ borderColor: 'var(--line)' }}>
                  {info.divisions.map((d) => (
                    <option key={d.division} value={d.division}>
                      {d.division}{d.fee_cents != null ? ` — ${money(d.fee_cents)}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {captain && (
              <>
                <label className="mt-3 block text-sm">
                  How many players
                  <input value={squadSize} onChange={(e) => setSquadSize(e.target.value)} type="number" min={5} max={30} inputMode="numeric" required className={field} style={{ borderColor: 'var(--line)' }} data-enter-squad-size />
                </label>
                <fieldset className="mt-3 text-sm">
                  <legend>Who pays the entry fee</legend>
                  <div className="mt-1 flex gap-1.5 text-xs">
                    {([['split', 'Split between the players'], ['captain', 'I pay the organiser']] as const).map(([k, label]) => (
                      <button key={k} type="button" onClick={() => setPayMode(k)} aria-pressed={payMode === k} className="rounded-full border px-3 py-1.5 font-semibold" style={payMode === k ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', color: 'var(--ink-2)' }} data-enter-pay-mode={k}>
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {fee != null && (
              <p className="mt-2 text-sm text-ink-2">
                Entry fee <b>{money(fee)}</b>{info.instructions ? ` — ${info.instructions}` : `, paid to ${info.organiser} once accepted.`}
                {share != null && payMode === 'split' ? ` Split ${squadSize} ways, ${money(share)} each, paid in the app.` : ''}
              </p>
            )}
          </section>
          <section className="mt-5">
            <span className="eyebrow">Who to contact</span>
            <label className="mt-2 block text-sm">
              Your name
              <input value={form.contactName} onChange={set('contactName')} required className={field} style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="mt-3 block text-sm">
              Mobile
              <input value={form.contactPhone} onChange={set('contactPhone')} type="tel" className={field} style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="mt-3 block text-sm">
              Email
              <input value={form.contactEmail} onChange={set('contactEmail')} type="email" className={field} style={{ borderColor: 'var(--line)' }} />
            </label>
            <label className="mt-3 block text-sm">
              Anything the organiser should know (optional)
              <textarea value={form.note} onChange={set('note')} rows={2} className={field} style={{ borderColor: 'var(--line)' }} />
            </label>
          </section>
          {error && (
            <p className="mt-4 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>
          )}
          <button type="submit" disabled={busy} className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            {busy ? 'Sending…' : 'Ask to enter'}
          </button>
          <p className="mt-3 text-center text-xs text-ink-3">Only the organiser sees these details.</p>
        </form>
      )}
    </main>
  )
}
