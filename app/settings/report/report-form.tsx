'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { CATEGORY } from '@/app/admin/safeguarding/conduct-register'

type Category = keyof typeof CATEGORY

export function ReportForm() {
  const [academy, setAcademy] = useState<{ id: string; name: string } | null | undefined>(undefined)
  const [category, setCategory] = useState<Category>('concern')
  const [description, setDescription] = useState('')
  const [occurredOn, setOccurredOn] = useState('')
  const [subject, setSubject] = useState('')
  const [involvesChild, setInvolvesChild] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: claims } = await supabase.auth.getClaims()
      if (!claims?.claims?.sub) return setAcademy(null)
      let org = getOrg()
      if (!org) {
        const { data: m } = await supabase.from('academy_members').select('academy_id').eq('status', 'active').limit(1).maybeSingle()
        org = m?.academy_id ?? null
      }
      if (!org) return setAcademy(null)
      const { data: a } = await supabase.from('academies').select('id, name').eq('id', org).maybeSingle()
      setAcademy(a ?? null)
    })()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!academy) return
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('file_conduct_report', {
      p_academy: academy.id,
      p_category: category,
      p_description: description,
      p_occurred_on: occurredOn || undefined,
      p_subject_name: subject || undefined,
      p_involves_child: involvesChild,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setSent(true)
  }

  if (academy === undefined) return <p className="p-5 text-center text-sm text-ink-3">One moment…</p>
  if (academy === null) return <p className="p-5 text-center text-sm text-ink-2">You are not in a club yet.</p>
  if (sent) {
    return (
      <div className="p-5">
        <p className="card p-5 text-sm">
          <b>Filed.</b> {academy.name}&apos;s safeguarding officers can see it now, and only they can. If a child is in danger right now, call 000.
        </p>
      </div>
    )
  }
  const field = 'mt-1 w-full rounded-xl border px-3 py-2.5 text-base'
  return (
    <form onSubmit={submit} className="p-5">
      <p className="text-sm text-ink-2">
        For something an adult did or said that worried you — at training, in a message, in a car. It goes to {academy.name}&apos;s safeguarding officers and nobody else; it is never posted anywhere.
      </p>
      <p className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>If a child is in danger right now, call 000 first.</p>
      <label className="mt-4 block text-sm">
        What kind of thing
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={field} style={{ borderColor: 'var(--line)' }}>
          {(Object.keys(CATEGORY) as Category[]).map((k) => <option key={k} value={k}>{CATEGORY[k]}</option>)}
        </select>
      </label>
      <label className="mt-3 block text-sm">
        What happened
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} required className={field} style={{ borderColor: 'var(--line)' }} placeholder="Who, what, where, when — in your own words" />
      </label>
      <label className="mt-3 block text-sm">
        When (if you know)
        <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} max={new Date().toISOString().slice(0, 10)} className={field} style={{ borderColor: 'var(--line)' }} />
      </label>
      <label className="mt-3 block text-sm">
        Who it is about (optional)
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} style={{ borderColor: 'var(--line)' }} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={involvesChild} onChange={(e) => setInvolvesChild(e.target.checked)} />
        A child is involved
      </label>
      {error && <p className="mt-3 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      <button type="submit" disabled={busy || description.trim().length < 10} className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
        {busy ? 'Filing…' : 'File the report'}
      </button>
    </form>
  )
}
