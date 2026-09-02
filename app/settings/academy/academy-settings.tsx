'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * The two safeguarding switches, with their consequences written out.
 *
 * Both default to the restrictive option. An academy can open them, but it
 * should be a decision someone made on purpose, having read what it does -
 * not something that drifted open because the wording was vague.
 */
/**
 * Six clubs' worth of colours, plus whatever they actually wear.
 *
 * Every one of these is dark enough to carry white text in the app bar,
 * which is the only real constraint — a club picking their own hi-vis
 * yellow would produce a header nobody can read. The custom field is there
 * because a club's colours are theirs, and a preset list is a guess.
 */
const PRESETS = [
  { name: 'NRIFA navy', value: '#202842' },
  { name: 'Bottle green', value: '#1C4634' },
  { name: 'Claret', value: '#6B1F32' },
  { name: 'Royal blue', value: '#17418C' },
  { name: 'Black', value: '#16181D' },
  { name: 'Forest', value: '#2E4A2C' },
]

export function AcademySettings({
  academyId, dmPolicy, directoryVisibility, primaryColour = '#202842', academyName = 'Your club',
}: {
  academyId: string
  dmPolicy: string
  directoryVisibility: string
  primaryColour?: string
  academyName?: string
}) {
  const router = useRouter()
  const [dm, setDm] = useState(dmPolicy)
  const [dir, setDir] = useState(directoryVisibility)
  const [colour, setColour] = useState(primaryColour)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typed to the two columns this screen may touch, rather than a loose
  // record. The generated types then check the values as well as the keys.
  type Patch =
    | { directory_visibility: 'staff_only' | 'all' }
    | { dm_policy: 'staff_only' | 'open' }
    | { primary_colour: string }

  async function update(patch: Patch) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('academies').update(patch).eq('id', academyId)
    setBusy(false)
    if (error) return setError(error.message)
    router.refresh()
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h2 className="font-semibold">Club colours</h2>
        <p className="mt-1 text-sm text-ink-2">
          Used across the app — the bar at the top, buttons, and the badge every family sees.
        </p>

        {/* The preview is the point. A hex code tells nobody anything; a
            navy bar with the club's initials on it tells them exactly what
            they are choosing. */}
        <div
          className="mt-3 flex items-center gap-3 rounded-xl px-4 pb-3.5 pt-3"
          style={{ background: colour, color: '#fff' }}
        >
          <span
            className="display grid h-9 w-9 flex-none place-items-center rounded-[10px] text-[15px]"
            style={{ background: '#ffffff26' }}
          >
            {academyName.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="display block truncate text-[21px] leading-tight">{academyName}</span>
            <span className="block text-xs opacity-75">This is how it will look</span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => { setColour(p.value); void update({ primary_colour: p.value }) }}
              aria-label={p.name}
              aria-pressed={colour.toLowerCase() === p.value.toLowerCase()}
              className="h-9 w-9 rounded-[9px] border-2"
              style={{
                background: p.value,
                borderColor: colour.toLowerCase() === p.value.toLowerCase() ? 'var(--ink)' : 'transparent',
                boxShadow: 'inset 0 0 0 1px #00000018',
              }}
            />
          ))}

          <label className="flex items-center gap-2 rounded-[9px] border border-[var(--line)] px-2.5">
            <input
              type="color"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
              onBlur={() => update({ primary_colour: colour })}
              className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
              aria-label="Choose any colour"
            />
            <span className="text-xs text-ink-2">Custom</span>
          </label>
        </div>

        <p className="mt-2 text-xs text-ink-3">
          Pick something dark enough for white text to read on — the club name sits on top of it.
        </p>
      </section>

      <section>
        <h2 className="font-semibold">Family phone numbers</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          Coaches and admins are always contactable. This is about whether families can
          see each other.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Option
            on={dir === 'staff_only'}
            disabled={busy}
            title="Staff only"
            detail="Parents can call coaches, not each other. The safer default."
            onClick={() => { setDir('staff_only'); update({ directory_visibility: 'staff_only' }) }}
          />
          <Option
            on={dir === 'all'}
            disabled={busy}
            title="Everyone in the academy"
            detail="Any member can call or WhatsApp any other. Convenient for lift-sharing; it also means every parent has every other parent's number."
            onClick={() => { setDir('all'); update({ directory_visibility: 'all' }) }}
          />
        </div>
      </section>

      <section>
        <h2 className="font-semibold">Private messages</h2>
        <p className="mt-0.5 text-sm text-ink-2">Inside Squadroom, where messages are kept.</p>
        <div className="mt-3 flex flex-col gap-2">
          <Option
            on={dm === 'staff_only'}
            disabled={busy}
            title="With coaches and admins only"
            detail="A parent can message their coach. Two parents cannot open a private thread."
            onClick={() => { setDm('staff_only'); update({ dm_policy: 'staff_only' }) }}
          />
          <Option
            on={dm === 'open'}
            disabled={busy}
            title="Anyone in the academy"
            detail="Any two members can message privately."
            onClick={() => { setDm('open'); update({ dm_policy: 'open' }) }}
          />
        </div>
      </section>
    </div>
  )
}

function Option({
  on, title, detail, onClick, disabled,
}: {
  on: boolean; title: string; detail: string; onClick: () => void; disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border p-3 text-left disabled:opacity-60"
      style={{ borderColor: on ? 'var(--brand)' : 'var(--line)', background: on ? 'var(--brand-faint)' : undefined }}
    >
      <span className="flex items-center gap-2">
        <span
          className="grid h-4 w-4 flex-none place-items-center rounded-full border"
          style={{ borderColor: on ? 'var(--brand)' : 'var(--ink-3)' }}
        >
          {on && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--brand)' }} />}
        </span>
        <span className="font-medium">{title}</span>
      </span>
      <span className="mt-1 block pl-6 text-sm text-ink-2">{detail}</span>
    </button>
  )
}
