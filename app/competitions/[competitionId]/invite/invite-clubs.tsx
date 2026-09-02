'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type ExistingInvite = {
  id: string
  clubName: string
  token: string
  status: string
}

/**
 * Paste a list of club names, get a draw entry and an invite link for each.
 *
 * An organiser with a hundred clubs is not typing them one at a time, and
 * they almost always already have the list — in an email, a spreadsheet, last
 * year's draw.
 */
export function InviteClubs({
  competitionId, origin, defaultDivision, existing, contactCount,
}: {
  competitionId: string
  origin: string
  defaultDivision: string
  existing: ExistingInvite[]
  contactCount: number
}) {
  const router = useRouter()
  const [division, setDivision] = useState(defaultDivision || 'U8s')
  const [text, setText] = useState('')
  const [groups, setGroups] = useState('3')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const names = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const groupCount = Math.max(1, Number(groups) || 1)

  // Shown before anything is created, because "Group C" appearing out of
  // nowhere on a draw is confusing and this is cheap to preview.
  const preview = names.map((club_name, i) => ({
    club_name,
    group_label: groupCount > 1 ? String.fromCharCode(65 + Math.floor(i / Math.ceil(names.length / groupCount))) : null,
  }))

  async function invite() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('bulk_invite_clubs', {
      p_competition: competitionId,
      p_division: division,
      p_clubs: preview,
    })
    setBusy(false)
    if (error) return setError(error.message)
    setText('')
    router.refresh()
  }

  async function copyAll() {
    const lines = existing
      .filter((i) => i.status === 'pending')
      .map((i) => `${i.clubName}: ${origin}/join-competition/${i.token}`)
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied('all')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="mt-5 flex flex-col gap-6">
      <section>
        <div className="flex gap-3">
          <label className="flex-[2]">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Division</span>
            <input value={division} onChange={(e) => setDivision(e.target.value)}
                   className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
          </label>
          <label className="flex-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">Groups</span>
            <input value={groups} onChange={(e) => setGroups(e.target.value)} inputMode="numeric"
                   className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2.5" />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            Club names, one per line
          </span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
                    placeholder={'Rizzo Yellow\nJoga Bonito\nKillarney Dragons'}
                    className="mt-1 w-full rounded-xl border border-[var(--line)] p-3 font-mono text-sm" />
        </label>

        {names.length > 0 && (
          <p className="mt-2 text-sm text-ink-2">
            {names.length} clubs into {groupCount} {groupCount === 1 ? 'group' : 'groups'} —{' '}
            {preview.filter((p) => p.group_label === 'A').length} in A
            {groupCount > 1 && `, ${preview.filter((p) => p.group_label === 'B').length} in B`}
            {groupCount > 2 && `, ${preview.filter((p) => p.group_label === 'C').length} in C`}
          </p>
        )}

        {error && <p className="mt-2 text-sm ">{error}</p>}

        <button onClick={invite} disabled={busy || names.length === 0}
                className="mt-3 w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--brand)' }}>
          {busy ? 'Adding…' : names.length ? `Add ${names.length} clubs to the draw` : 'Nothing to add'}
        </button>

        <p className="mt-2 text-xs text-ink-2">
          {/* The reassurance that makes an organiser willing to press it. */}
          They go on the draw straight away. Each gets a link; a club that never uses it stays a
          name on the sheet.
        </p>
      </section>

      {existing.length > 0 && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
              Invited · {existing.length}
            </h2>
            <button onClick={copyAll} className="text-sm font-semibold" style={{ color: 'var(--brand)' }}>
              {copied ? 'Copied' : 'Copy all links'}
            </button>
          </div>

          <div className="mt-2 rounded-xl border border-[var(--line)]">
            {existing.map((i, n) => (
              <div key={i.id} className={`flex items-center gap-2 p-2.5 ${n > 0 ? 'border-t border-[var(--line-2)]' : ''}`}>
                <span className="min-w-0 flex-1 truncate text-sm">{i.clubName}</span>
                <span className="flex-none text-xs" style={{ color: i.status === 'claimed' ? 'var(--yes)' : 'var(--ink-3)' }}>
                  {i.status === 'claimed' ? 'joined' : 'invited'}
                </span>
                {i.status === 'pending' && (
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${origin}/join-competition/${i.token}`)
                      setCopied(i.id)
                      setTimeout(() => setCopied(null), 2000)
                    }}
                    className="flex-none rounded border border-[var(--line)] px-2 py-0.5 text-xs"
                  >
                    {copied === i.id ? 'Copied' : 'Link'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {contactCount > 0 && (
            <p className="mt-2 text-xs text-ink-2">
              Send each link to that club however you already talk to them — email, WhatsApp, the
              group you are already in.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
