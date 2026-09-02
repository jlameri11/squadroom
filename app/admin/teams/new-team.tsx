'use client'

import { Sheet } from '@/components/sheet'

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
        className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
        style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
        aria-label="Add a team"
      >
        ＋
      </button>
    )
  }

  return (
    <Sheet onClose={() => setOpen(false)}><form onSubmit={submit}>
        <h2 className="display mb-3 text-xl">Add a team</h2>
        <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Team name</span>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="U8 SPL"
          className="rounded-xl border border-[var(--line)] px-3 py-3"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Age group</span>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3"
          >
            {AGE_GROUPS.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Season</span>
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="rounded-xl border border-[var(--line)] px-3 py-3"
          />
        </label>
      </div>

      </div>

      {error && <p className="mt-3 text-sm ">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Creating…' : 'Create team'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-[var(--line)] px-4 py-3"
        >
          Cancel
        </button>
      </div>
      <p className="mt-3 text-xs text-ink-2">
        Its channel is created automatically, and coaches join it as hosts.
      </p>
      </form>
    </Sheet>
  )
}
