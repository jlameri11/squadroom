'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Person = { profile_id: string; name: string; role: string; club: string | null }
type Contacts = { standing: 'league' | 'head' | null; clubs_channel_id: string | null; people: Person[] }

/**
 * Who runs this competition, and who runs the clubs in it (Joey, 9 Nov
 * 2026, "Academy vs league organiser" 2–3). A league's staff and the head
 * (owner or admin) of every entered club share the competition's Clubs chat
 * — two-way, nobody added by hand, members following the entries — and may
 * start a one-to-one chat with each other here. Never with a club's parents
 * or coaches, and never one club's head with another's: the database
 * refuses it (open_competition_direct), this screen simply does not offer
 * it. Names and roles only; no phone numbers.
 */
export function CompetitionPeople({ competitionId }: { competitionId: string }) {
  const router = useRouter()
  const [c, setC] = useState<Contacts | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      const { data, error } = await createClient().rpc('competition_people', { p_competition: competitionId })
      if (live) setC(error ? null : ((data as unknown as Contacts | null) ?? null))
    })()
    return () => {
      live = false
    }
  }, [competitionId])

  if (!c || !c.standing) return null

  async function message(p: Person) {
    setBusy(p.profile_id)
    setError(null)
    const { data, error } = await createClient().rpc('open_competition_direct', { p_competition: competitionId, p_other: p.profile_id })
    setBusy(null)
    if (error) return setError(error.message)
    router.push(`/chat/${data as string}`)
  }

  return (
    <div className="m-3.5 rounded-xl border p-3.5 text-sm" style={{ borderColor: 'var(--line)' }} data-competition-people>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <b>{c.standing === 'league' ? 'The clubs\u2019 heads' : 'The league\u2019s staff'}</b>
          <span className="block text-xs text-ink-3">
            {c.standing === 'league'
              ? 'Every entered club\u2019s owners and admins. They and you share the Clubs chat; message one directly here.'
              : 'Who runs this competition. You share the Clubs chat with them and the other clubs\u2019 heads; message one directly here.'}
          </span>
        </span>
        {c.clubs_channel_id && (
          <Link href={`/chat/${c.clubs_channel_id}`} className="flex-none rounded-xl px-3.5 py-2 text-sm font-semibold text-brand-ink" style={{ background: 'var(--brand)' }} data-clubs-chat>
            Clubs chat
          </Link>
        )}
      </div>
      {error && <p className="mt-2 rounded-lg p-2 text-xs" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      {c.people.length === 0 ? (
        <p className="mt-2 text-xs text-ink-3">Nobody yet.</p>
      ) : (
        <ul className="mt-2 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {c.people.map((p) => (
            <li key={p.profile_id} className="flex items-center gap-2 py-2" data-person={p.profile_id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-xs text-ink-3">{[p.role, p.club].filter(Boolean).join(' · ')}</span>
              </span>
              <button onClick={() => message(p)} disabled={busy !== null} className="flex-none rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--brand)', color: 'var(--brand-text)' }} data-message={p.profile_id}>
                {busy === p.profile_id ? '…' : 'Message'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
