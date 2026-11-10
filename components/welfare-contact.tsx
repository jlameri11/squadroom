'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

type Contact = { profile_id: string; name: string; role: string }
type Contacts = { officers: Contact[]; president: Contact[]; can_message: boolean }

/**
 * The club's safeguarding contact, in every family's Settings (Joey, 10 Nov
 * 2026, Part A fix 4; 0241): the Welfare officer (Member Protection) by
 * name, and one tap to message them — a parent may always reach the
 * officer, whatever the club's direct-message setting. No phone number
 * here: the message is the door.
 */
export function WelfareContact() {
  const router = useRouter()
  const [data, setData] = useState<Contacts | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const org = getOrg()
      if (!org) return
      const { data } = await createClient().rpc('welfare_contacts', { p_academy: org })
      if (live) setData((data as unknown as Contacts | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [])

  if (!data || (data.officers.length === 0 && data.president.length === 0)) return null

  async function message(profileId: string) {
    const org = getOrg()
    if (!org) return
    setBusy(profileId)
    setError(null)
    const { data: channel, error } = await createClient().rpc('open_direct_channel', { p_academy: org, p_other: profileId })
    setBusy(null)
    if (error) return setError(error.message)
    router.push(`/chat/${channel as string}`)
  }

  const people = data.officers.length > 0 ? data.officers : data.president
  return (
    <section className="mt-6" data-welfare-contact={people.length}>
      <h2 className="font-semibold">Your club&apos;s welfare contact</h2>
      <p className="mt-0.5 text-sm text-ink-2">
        {data.officers.length > 0
          ? 'The Welfare officer (Member Protection) hears any concern about a child’s safety or an adult’s conduct, in confidence.'
          : 'No Welfare officer is appointed yet; the President hears any concern in the meantime.'}
      </p>
      <ul className="mt-2 divide-y rounded-xl border text-sm" style={{ borderColor: 'var(--line)' }}>
        {people.map((p) => (
          <li key={p.profile_id} className="flex items-center justify-between gap-3 px-3 py-2.5" data-welfare-person={p.profile_id}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{p.name}</span>
              <span className="block truncate text-xs text-ink-3">{p.role}</span>
            </span>
            {data.can_message && (
              <button onClick={() => message(p.profile_id)} disabled={busy !== null} className="flex-none rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-welfare-message={p.profile_id}>
                {busy === p.profile_id ? '…' : 'Message'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--no)' }} role="alert">{error}</p>}
    </section>
  )
}
