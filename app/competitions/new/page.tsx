'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MODES = [
  {
    value: 'managed' as const,
    label: 'Squadroom runs it',
    hint: 'We build the draw, keep the ladder and set up the finals. For a tournament or gala day nobody else is running.',
  },
  {
    value: 'comms_only' as const,
    label: 'We run it elsewhere',
    hint: 'Keep Dribl or whatever you use. Squadroom becomes the way you reach every club, and parents still get reminders.',
  },
]

export default function NewCompetition() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [organiserId, setOrganiserId] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<'season' | 'tournament' | 'gala_day' | 'friendly_series'>('tournament')
  const [mode, setMode] = useState<'managed' | 'comms_only'>('managed')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('academies').select('id, name').order('name').then(({ data }) => {
      setOrgs(data ?? [])
      setOrganiserId(data?.[0]?.id ?? '')
    })
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('competitions')
      .insert({
        organiser_id: organiserId,
        name: name.trim(),
        type,
        mode,
        season: String(new Date().getFullYear()),
      })
      .select('id')
      .single()
    setBusy(false)
    if (error) return setError(error.message)
    router.replace(`/competitions/${data.id}/invite`)
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>New competition</h1>

      <form onSubmit={create} className="mt-5 flex flex-col gap-4">
        {orgs.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Run by</span>
            <select value={organiserId} onChange={(e) => setOrganiserId(e.target.value)}
                    className="rounded-xl border border-neutral-300 px-3 py-3">
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="NRIFA U7s Tournament"
                 className="rounded-xl border border-neutral-300 px-3 py-3" />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">What is it</span>
          <div className="flex flex-wrap gap-2">
            {(['tournament', 'gala_day', 'season', 'friendly_series'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                      className="rounded-full border px-3 py-1.5 text-sm capitalize"
                      style={type === t
                        ? { background: '#202842', borderColor: '#202842', color: '#fff' }
                        : { borderColor: '#E5E7EB', color: '#4B5563' }}>
                {t.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Who runs the competition
          </legend>
          {/* This choice is hard to change later — fixtures and results start
              accumulating in one place or the other — so it is spelled out
              rather than reduced to a toggle. */}
          {MODES.map((m) => (
            <label key={m.value}
                   className="flex cursor-pointer items-start gap-3 rounded-xl border p-3"
                   style={{ borderColor: mode === m.value ? '#202842' : '#E5E7EB' }}>
              <input type="radio" name="mode" className="mt-1"
                     checked={mode === m.value} onChange={() => setMode(m.value)} />
              <span>
                <span className="block font-medium">{m.label}</span>
                <span className="block text-sm text-neutral-500">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={busy || !organiserId}
                className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
                style={{ background: '#202842' }}>
          {busy ? 'Creating…' : 'Create and invite clubs'}
        </button>
      </form>
    </main>
  )
}
