'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const AGE_GROUPS = ['U5','U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18']

export function NewTeam({ academyId }: { academyId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ageGroup, setAgeGroup] = useState('U8')
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.from('teams').insert({
      academy_id: academyId,
      name: name.trim(),
      age_group: ageGroup,
      season,
    })

    setBusy(false)
    if (error) {
      // The unique constraint is on (academy, name, season), so this is the
      // likely one and deserves a human sentence rather than a Postgres one.
      return setError(
        error.code === '23505'
          ? `You already have a team called “${name.trim()}” this season.`
          : error.message
      )
    }
    setName('')
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl px-4 py-3 font-medium text-white"
        style={{ background: '#202842' }}
      >
        New team
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3 rounded-xl border border-neutral-300 p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Team name</span>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="U8 SPL"
          className="rounded-xl border border-neutral-300 px-3 py-3"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Age group</span>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
            className="rounded-xl border border-neutral-300 px-3 py-3"
          >
            {AGE_GROUPS.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Season</span>
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="rounded-xl border border-neutral-300 px-3 py-3"
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: '#202842' }}
        >
          {busy ? 'Creating…' : 'Create team'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-neutral-300 px-4 py-3"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Its channel is created automatically, and coaches join it as hosts.
      </p>
    </form>
  )
}
