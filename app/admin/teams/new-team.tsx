'use client'

import { Sheet } from '@/components/sheet'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Juniors U5–U18 as before; then the age groups a big club has (0236):
// U19–U23, Open (seniors, women), Over-35s and up.
const AGE_GROUPS = ['U5','U6','U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18','U19','U20','U21','U23','Open','Over-35','Over-40','Over-45']
const GENDERS: { value: '' | 'female' | 'male' | 'other'; label: string }[] = [
  { value: '', label: 'Mixed / not set' },
  { value: 'female', label: 'Girls / women' },
  { value: 'male', label: 'Boys / men' },
  { value: 'other', label: 'Other' },
]

export function NewTeam({
  academyId,
  onCreated,
}: {
  academyId: string
  /** Re-reads the list. router.refresh() could be served from the client
      router cache, so a coach made a team and did not see it. */
  onCreated?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ageGroup, setAgeGroup] = useState('U8')
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [gender, setGender] = useState<'' | 'female' | 'male' | 'other'>('')
  const [streamId, setStreamId] = useState('')
  const [streams, setStreams] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The club's streams (0236), if it has any; an academy with none sees no picker.
  useEffect(() => {
    let live = true
    ;(async () => {
      const { data } = await createClient().from('streams').select('id, name').eq('academy_id', academyId).order('sort_order').order('name')
      if (live) setStreams((data as { id: string; name: string }[] | null) ?? [])
    })()
    return () => {
      live = false
    }
  }, [academyId])

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
      gender: gender || null,
      stream_id: streamId || null,
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
    if (onCreated) onCreated()
    else router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
        style={{ background: 'color-mix(in srgb, var(--bar-ink) 16%, transparent)', color: 'var(--bar-ink)' }}
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

      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Who plays</span>
          <select value={gender} onChange={(e) => setGender(e.target.value as '' | 'female' | 'male' | 'other')} className="rounded-xl border border-[var(--line)] px-3 py-3" data-team-gender>
            {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        {streams.length > 0 && (
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Stream</span>
            <select value={streamId} onChange={(e) => setStreamId(e.target.value)} className="rounded-xl border border-[var(--line)] px-3 py-3" data-team-stream>
              <option value="">None</option>
              {streams.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
          </label>
        )}
      </div>

      </div>

      {error && <p className="mt-3 text-sm ">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-xl px-4 py-3 font-medium text-brand-ink disabled:opacity-50"
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
