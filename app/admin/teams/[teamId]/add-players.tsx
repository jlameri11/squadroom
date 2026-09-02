'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Adding players to a squad.
 *
 * Until now a player only came into existence when a family joined, which
 * means a coach setting up in February — with a team sheet in front of them
 * and not one parent signed up yet — had nowhere to put twelve names.
 *
 * So it takes a list. One name per line, because that is the shape the
 * information is already in: a team sheet, an email from the association, a
 * note on a phone. Typing them one at a time through a form with a Save
 * button between each is the kind of small tax that makes people give up and
 * keep using the spreadsheet.
 *
 * Guardians are linked later, as families join and are matched to a child.
 * A player with no guardian is a normal state here, not an error.
 */
export function AddPlayers({
  teamId,
  academyId,
  existing,
}: {
  teamId: string
  academyId: string
  existing: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const known = useMemo(
    () => new Set(existing.map((n) => n.trim().toLowerCase())),
    [existing]
  )

  const parsed = useMemo(() => {
    const seen = new Set<string>()
    return text
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .map((name) => {
        const key = name.toLowerCase()
        // Two kinds of duplicate, and they need different words: one is in
        // the squad already, one is typed twice in this box.
        const status = known.has(key) ? 'already' : seen.has(key) ? 'twice' : 'new'
        seen.add(key)
        return { name, status }
      })
  }, [text, known])

  const fresh = parsed.filter((p) => p.status === 'new')
  const skipped = parsed.filter((p) => p.status !== 'new')

  async function add() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.from('players').insert(
      fresh.map((p) => ({ academy_id: academyId, team_id: teamId, full_name: p.name }))
    )
    setBusy(false)
    if (error) return setError(error.message)
    setText('')
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
        style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
        aria-label="Add players"
      >
        ＋
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" style={{ background: '#0E172680' }}>
      <div
        className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--surface)' }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
        <h2 className="display text-xl">Add players</h2>
        <p className="mt-1 text-sm text-ink-2">
          One name per line. Paste your team sheet straight in.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          autoFocus
          placeholder={'Leo Whitfield\nAda Okafor\nCharlie Bradley'}
          className="mt-3 w-full rounded-xl border border-[var(--line)] p-3"
        />

        {parsed.length > 0 && (
          <div className="mt-3 rounded-xl border border-[var(--line)] p-3">
            <p className="text-sm font-medium">
              {fresh.length} to add
              {skipped.length > 0 && `, ${skipped.length} skipped`}
            </p>
            <ul className="mt-1.5 flex flex-col gap-0.5 text-sm">
              {parsed.slice(0, 14).map((p, i) => (
                <li
                  key={`${p.name}-${i}`}
                  className="flex justify-between gap-2"
                  style={{ color: p.status === 'new' ? 'var(--ink)' : 'var(--ink-3)' }}
                >
                  <span className="truncate">{p.name}</span>
                  {p.status === 'already' && <span className="flex-none text-xs">already in the squad</span>}
                  {p.status === 'twice' && <span className="flex-none text-xs">typed twice</span>}
                </li>
              ))}
              {parsed.length > 14 && (
                <li className="text-xs text-ink-3">…and {parsed.length - 14} more</li>
              )}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <p className="mt-3 text-xs text-ink-3">
          Parents are linked to their children as families join — a player with nobody attached yet
          is normal.
        </p>

        <div className="mt-4 flex gap-2">
          <button onClick={add} disabled={busy || fresh.length === 0} className="btn flex-1 disabled:opacity-50">
            {busy ? 'Adding…' : fresh.length ? `Add ${fresh.length}` : 'Nothing to add'}
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-quiet">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
