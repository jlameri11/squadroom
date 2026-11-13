'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Your name in three parts and your mobile (the sign-up brief, 12 Nov 2026).
 * The parts are what sign-up asks for; full_name is made from them for every
 * screen that shows a name. A name the migration split on its own and found
 * odd carries a note until the person (or the club) confirms it.
 */
export function ProfileForm({
  initial,
  email,
}: {
  initial: { first: string; middle: string; last: string; phone: string; checkNeeded: boolean }
  email: string | null
}) {
  const router = useRouter()
  const [first, setFirst] = useState(initial.first)
  const [middle, setMiddle] = useState(initial.middle)
  const [last, setLast] = useState(initial.last)
  const [phone, setPhone] = useState(initial.phone)
  const [checkNeeded, setCheckNeeded] = useState(initial.checkNeeded)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)

    const supabase = createClient()
    const { error: nameErr } = await supabase.rpc('set_my_name', {
      p_first: first.trim(),
      p_middle: middle.trim() || undefined,
      p_last: last.trim(),
    })
    if (nameErr) {
      setBusy(false)
      return setError(nameErr.message)
    }
    if (phone.trim() !== initial.phone.trim()) {
      // set_my_profile keeps the name when given none, and parses the number.
      const { error: phoneErr } = await supabase.rpc('set_my_profile', { p_full_name: '', p_phone: phone })
      if (phoneErr) {
        setBusy(false)
        return setError(phoneErr.message)
      }
    }

    setBusy(false)
    setCheckNeeded(false)
    setSaved(true)
    router.refresh()
  }

  const field = 'rounded-xl border border-[var(--line)] px-3 py-3'

  return (
    <form onSubmit={save} className="mt-5 flex flex-col gap-4" data-profile-form>
      {checkNeeded && (
        <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--surface-2)' }} data-name-check>
          We split your name into first and last automatically — check it&apos;s right and save.
        </p>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">First name</span>
        <input required value={first} onChange={(e) => setFirst(e.target.value)} className={field} autoComplete="given-name" data-first-name />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Middle name <span className="font-normal normal-case tracking-normal text-ink-3">(optional)</span></span>
        <input value={middle} onChange={(e) => setMiddle(e.target.value)} className={field} autoComplete="additional-name" data-middle-name />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Last name</span>
        <input required value={last} onChange={(e) => setLast(e.target.value)} className={field} autoComplete="family-name" data-last-name />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Mobile</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="0412 345 678"
          className={field}
          autoComplete="tel"
        />
        <span className="text-xs text-ink-2">
          {/* Say what it is for and who sees it, at the point of asking. */}
          So your team can call or text you. Coaches and admins are always
          contactable; whether families can see each other&apos;s numbers is your
          academy&apos;s setting.
        </span>
      </label>

      {/* A phone-joined parent's sign-in address is a placeholder made from
          their number (lib/join.ts) — never shown, it means nothing to them. */}
      {email && !email.toLowerCase().endsWith('@squadroom.invalid') && (
        <p className="text-xs text-ink-2">
          You sign in with {email}.
        </p>
      )}

      {error && <p className="text-sm ">{error}</p>}
      {saved && <p className="text-sm ">Saved.</p>}

      <button
        type="submit"
        disabled={busy}
        className="rounded-xl px-4 py-3 font-medium text-brand-ink disabled:opacity-50"
        style={{ background: 'var(--brand)' }}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
  )
}
