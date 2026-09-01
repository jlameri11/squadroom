'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function ProfileForm({
  initialName, initialPhone, email,
}: {
  initialName: string
  initialPhone: string
  email: string | null
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)

    const supabase = createClient()
    const { error } = await supabase.rpc('set_my_profile', {
      p_full_name: name,
      p_phone: phone,
    })

    setBusy(false)
    if (error) return setError(error.message)
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={save} className="mt-5 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl border border-neutral-300 px-3 py-3"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Mobile</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="0412 345 678"
          className="rounded-xl border border-neutral-300 px-3 py-3"
        />
        <span className="text-xs text-neutral-500">
          {/* Say what it is for and who sees it, at the point of asking. */}
          So your team can call or text you. Coaches and admins are always
          contactable; whether families can see each other&apos;s numbers is your
          academy&apos;s setting.
        </span>
      </label>

      {email && (
        <p className="text-xs text-neutral-500">
          You sign in with {email}.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-700">Saved.</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
        style={{ background: '#202842' }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
