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
export function AcademySettings({
  academyId, dmPolicy, directoryVisibility,
}: {
  academyId: string
  dmPolicy: string
  directoryVisibility: string
}) {
  const router = useRouter()
  const [dm, setDm] = useState(dmPolicy)
  const [dir, setDir] = useState(directoryVisibility)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Typed to the two columns this screen may touch, rather than a loose
  // record. The generated types then check the values as well as the keys.
  type Patch =
    | { directory_visibility: 'staff_only' | 'all' }
    | { dm_policy: 'staff_only' | 'open' }

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
      style={{ borderColor: on ? 'var(--brand)' : 'var(--line)', background: on ? 'var(--brand)0a' : undefined }}
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
