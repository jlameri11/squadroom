'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Acc = { id: string; title: string; number: string | null; expires_on: string; days_left: number; state: 'current' | 'expiring' | 'expired'; verified_by: string | null; verified_at: string; note: string | null }
type Row = { profile_id: string; name: string; role: string; coaches: string | null; accreditations: Acc[] }

const COURSES = ['Foundation of Football', 'MiniRoos Certificate', 'Skill Training Certificate', 'Game Training Certificate', 'Senior Coaching C Licence', 'First aid']

/**
 * Coaching accreditation (Big Club Mode item 11; 0253): a course
 * certificate with a date, several per person, recorded by an owner or
 * admin for someone else. Thirty days out the person and the club are
 * reminded; an expired one is named here. It does not take a coach's
 * rights away — the Working With Children Check above is what does that.
 */
export function Accreditations() {
  const [rows, setRows] = useState<Row[] | null | undefined>(undefined)
  const [open, setOpen] = useState<string | null>(null)
  const [title, setTitle] = useState(COURSES[0])
  const [custom, setCustom] = useState('')
  const [number, setNumber] = useState('')
  const [expires, setExpires] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('accreditation_board', { p_academy: (getOrg() ?? null) as unknown as string })
    setRows((data as unknown as Row[] | null) ?? null)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  if (rows === undefined || rows === null) return null

  async function record(profileId: string) {
    setBusy(profileId)
    setError(null)
    const { error } = await createClient().rpc('record_accreditation', {
      p_academy: (getOrg() ?? null) as unknown as string,
      p_profile: profileId,
      p_title: title === 'other' ? custom.trim() : title,
      p_expires_on: expires,
      p_number: (number.trim() || null) as unknown as string,
      p_note: null as unknown as string,
    })
    setBusy(null)
    if (error) return setError(error.message)
    setOpen(null)
    setNumber('')
    setExpires('')
    await load()
  }
  async function remove(id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc('remove_accreditation', { p_accreditation: id })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  const line = { borderColor: 'var(--line)' }
  const tone = (s: Acc['state']) => (s === 'expired' ? 'var(--no)' : s === 'expiring' ? 'var(--accent)' : 'var(--yes)')
  const needing = rows.filter((r) => r.accreditations.some((a) => a.state !== 'current'))

  return (
    <section className="px-3.5 pb-6 pt-5" data-accreditations={rows.length}>
      <div className="sect">
        <span className="eyebrow">Coaching accreditation</span>
        <span className="text-xs text-ink-3">{needing.length ? `${needing.length} to chase` : 'nothing running out'}</span>
      </div>
      <p className="mt-1 text-xs text-ink-3">A course certificate with its date. The person and the club are reminded thirty days out. It does not take a coach off a squad — the check above does that.</p>
      <ul className="mt-2 flex flex-col divide-y divide-[var(--line-2)]">
        {rows.map((r) => (
          <li key={r.profile_id} className="py-2.5" data-accreditation-row={r.profile_id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{r.name}{r.coaches ? <span className="text-xs font-normal text-ink-3"> · {r.coaches}</span> : ''}</span>
              <button onClick={() => setOpen(open === r.profile_id ? null : r.profile_id)} className="tap flex-none text-xs underline underline-offset-4" style={{ color: 'var(--brand-text)' }} data-accreditation-add={r.profile_id}>
                {open === r.profile_id ? 'Not now' : 'Record one'}
              </button>
            </div>
            {r.accreditations.length === 0 ? (
              <span className="block text-xs text-ink-3">None recorded</span>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                {r.accreditations.map((a) => (
                  <li key={a.id} className="flex items-center gap-2" data-accreditation={a.id} data-accreditation-state={a.state}>
                    <span className="min-w-0 flex-1 truncate">{a.title}{a.number ? <span className="text-ink-3"> · {a.number}</span> : ''}</span>
                    <span className="flex-none text-xs" style={{ color: tone(a.state) }}>
                      {a.state === 'expired' ? `expired ${Math.abs(a.days_left)}d ago` : a.state === 'expiring' ? `${a.days_left}d left` : `to ${new Date(a.expires_on).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`}
                    </span>
                    <button onClick={() => remove(a.id)} disabled={busy !== null} className="tap flex-none text-xs text-ink-3" aria-label={`Remove ${a.title}`}>×</button>
                  </li>
                ))}
              </ul>
            )}
            {open === r.profile_id && (
              <div className="mt-2 rounded-lg border p-2.5" style={line} data-accreditation-form>
                <label className="block text-xs text-ink-2">
                  Course
                  <select value={title} onChange={(e) => setTitle(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line}>
                    {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="other">Another course</option>
                  </select>
                </label>
                {title === 'other' && (
                  <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="The course" className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} aria-label="The course" />
                )}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block text-xs text-ink-2">
                    Number (optional)
                    <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} data-accreditation-number />
                  </label>
                  <label className="block text-xs text-ink-2">
                    Runs out
                    <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm" style={line} data-accreditation-expires />
                  </label>
                </div>
                <button onClick={() => record(r.profile_id)} disabled={busy !== null || !expires || (title === 'other' && !custom.trim())} className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }} data-accreditation-save>
                  {busy === r.profile_id ? 'Saving…' : 'Record it'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
