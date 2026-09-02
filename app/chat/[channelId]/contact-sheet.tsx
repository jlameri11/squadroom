'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Contact = {
  profile_id: string
  full_name: string
  role: string
  teams: string[]
  phone: string | null
  can_dm: boolean
  is_me: boolean
}

/**
 * Tap a name in chat, get the ways to reach that person.
 *
 * Whether a number comes back is decided by the database, not here. If phone
 * is null the academy withheld it, so the sheet says so plainly rather than
 * rendering dead buttons or pretending the person has no number.
 */
export function ContactSheet({
  academyId, profileId, onClose,
}: {
  academyId: string
  profileId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [busy, setBusy] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    let cancelled = false
    supabase.rpc('member_contact', { p_academy: academyId, p_profile: profileId })
      .then(({ data }) => { if (!cancelled) setContact((data?.[0] ?? null) as Contact | null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [academyId, profileId])

  async function openDm() {
    if (!contact) return
    setBusy(true)
    const { data } = await supabase.rpc('open_direct_channel', {
      p_academy: academyId, p_other: contact.profile_id,
    })
    setBusy(false)
    if (data) { onClose(); router.push(`/chat/${data}`) }
  }

  const digits = contact?.phone?.replace(/\D/g, '') ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-md rounded-t-2xl bg-[var(--surface)] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />

        {!contact ? (
          <p className="py-6 text-center text-sm text-ink-2">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span
                className="grid h-12 w-12 flex-none place-items-center rounded-full text-sm font-bold text-white"
                style={{ background: 'var(--brand)' }}
              >
                {contact.full_name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{contact.full_name}</p>
                <p className="text-sm capitalize text-ink-2">
                  {contact.role}
                  {contact.teams.length > 0 && ` · ${contact.teams.join(', ')}`}
                </p>
              </div>
            </div>

            {contact.is_me ? (
              <p className="mt-5 text-center text-sm text-ink-2">This is you.</p>
            ) : (
              <div className="mt-5 flex flex-col gap-2">
                {contact.can_dm && (
                  <button
                    onClick={openDm}
                    disabled={busy}
                    className="rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
                    style={{ background: 'var(--brand)' }}
                  >
                    {busy ? 'Opening…' : 'Message in Squadroom'}
                  </button>
                )}

                {contact.phone ? (
                  <div className="grid grid-cols-3 gap-2">
                    <a href={`tel:${contact.phone}`} className="rounded-xl border border-[var(--line)] py-3 text-center text-sm font-medium">
                      Call
                    </a>
                    <a href={`sms:${contact.phone}`} className="rounded-xl border border-[var(--line)] py-3 text-center text-sm font-medium">
                      Text
                    </a>
                    <a
                      href={`https://wa.me/${digits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-[var(--line)] py-3 text-center text-sm font-medium"
                    >
                      WhatsApp
                    </a>
                  </div>
                ) : (
                  <p className="rounded-xl bg-[var(--surface-2)] p-3 text-center text-xs text-ink-2">
                    {/* Two different reasons, and a coach needs to tell them
                        apart: the academy hid it, or nobody ever entered one. */}
                    Your academy keeps family phone numbers private. Coaches and admins are
                    always contactable.
                  </p>
                )}

                <p className="pt-1 text-center text-xs tabular-nums text-ink-3">
                  {contact.phone ?? ''}
                </p>
              </div>
            )}
          </>
        )}

        <button onClick={onClose} className="mt-4 w-full py-2 text-sm text-ink-2">
          Close
        </button>
      </div>
    </div>
  )
}
