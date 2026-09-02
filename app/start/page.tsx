'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TYPES = [
  { value: 'academy', label: 'Academy', hint: 'Several teams across age groups' },
  { value: 'club', label: 'Club or team', hint: 'One team, or a few mates' },
  { value: 'league', label: 'League', hint: 'You run a competition others enter' },
  { value: 'school', label: 'School', hint: 'A school football program' },
] as const

/**
 * Founding an organisation.
 *
 * Deliberately four fields and a button. Anything else - logo, colours,
 * timezone - can be changed later, and asking for it now is the difference
 * between a coach finishing setup on the sideline and abandoning it.
 */
export default function Start() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('academy')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    // A security-definer function, not an insert: creating the organisation
    // and becoming its owner has to happen together, and the RLS policy on
    // academy_members quite rightly will not let you add yourself.
    const { error } = await supabase.rpc('create_academy', {
      p_name: name,
      p_type: type,
    })

    setBusy(false)
    if (error) return setError(error.message)
    router.replace('/')
    router.refresh()
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--brand)' }}>
          Set up your organisation
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          You&apos;ll be the owner. You can invite coaches straight after.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NRIFA Football Academy"
            className="rounded-xl border border-[var(--line)] px-3 py-3"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">
            What is it?
          </legend>
          {TYPES.map((t) => (
            <label
              key={t.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                type === t.value ? 'border-[var(--brand)]' : 'border-[var(--line)]'
              }`}
            >
              <input
                type="radio"
                name="type"
                className="mt-1"
                checked={type === t.value}
                onChange={() => setType(t.value)}
              />
              <span>
                <span className="block font-medium">{t.label}</span>
                <span className="block text-sm text-ink-2">{t.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && <p className="text-sm ">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy ? 'Creating…' : 'Create it'}
        </button>
      </form>
    </main>
  )
}
