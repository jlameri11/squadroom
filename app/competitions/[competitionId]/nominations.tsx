'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type MyEntry = { entry_id: string; name: string; division: string; proposed_division: string | null; note: string | null; nominated_at: string | null; locked: boolean; players: number }
type Nomination = MyEntry & { club: string | null; outside_band: number }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

/**
 * L-27, the club's side: propose a division for each team with a comment.
 * Nominating locks the squad — what was nominated is what plays — until the
 * league unlocks it.
 */
export function MyNominations({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<MyEntry[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [division, setDivision] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('my_entries', { p_competition: competitionId })
    setRows((data as unknown as MyEntry[] | null) ?? [])
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function nominate(entryId: string) {
    setBusy(true)
    setError(null)
    const { error } = await createClient().rpc('nominate_entry', { p_entry: entryId, p_division: division, p_note: note || undefined })
    setBusy(false)
    if (error) return setError(error.message)
    setOpen(null)
    setDivision('')
    setNote('')
    await load()
  }

  if (!rows || rows.length === 0) return null
  return (
    <section className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }} data-my-nominations>
      <h3 className="text-sm font-semibold">Your teams</h3>
      <p className="mt-0.5 text-xs text-ink-2">Propose a division and say why. Nominating locks the squad; the league sets the final division.</p>
      <ul className="mt-2 flex flex-col gap-2">
        {rows.map((e) => (
          <li key={e.entry_id} className="rounded-lg border p-2.5 text-sm" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-medium">{e.name}</span>
                <span className="block text-xs text-ink-3">
                  {e.players} players · in {e.division}
                  {e.nominated_at ? ` · nominated ${day(e.nominated_at)} for ${e.proposed_division}` : ''}
                  {e.locked ? ' · squad locked' : ''}
                </span>
              </span>
              {!e.locked && open !== e.entry_id && (
                <button onClick={() => { setOpen(e.entry_id); setDivision(e.division) }} className="flex-none rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                  Nominate
                </button>
              )}
            </div>
            {e.note && <p className="mt-1 text-xs text-ink-3">{e.note}</p>}
            {open === e.entry_id && (
              <div className="mt-2 flex flex-col gap-1.5">
                <input value={division} onChange={(ev) => setDivision(ev.target.value)} placeholder="Division you propose" className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Proposed division" />
                <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Why — last season, the squad's strength" className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Comment" />
                <div className="flex gap-2">
                  <button onClick={() => nominate(e.entry_id)} disabled={busy || !division.trim()} className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>
                    {busy ? '…' : 'Nominate and lock the squad'}
                  </button>
                  <button onClick={() => setOpen(null)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}

/** L-27, the league's side: what each club proposed; set the division, unlock a squad. */
export function Nominations({ competitionId }: { competitionId: string }) {
  const [rows, setRows] = useState<Nomination[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [division, setDivision] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('entry_nominations', { p_competition: competitionId })
    setRows((data as unknown as Nomination[] | null) ?? [])
  }, [competitionId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function call(fn: 'set_entry_division' | 'lock_entry_squad', args: Record<string, unknown>, id: string) {
    setBusy(id)
    setError(null)
    const { error } = await createClient().rpc(fn, args as never)
    setBusy(null)
    if (error) return setError(error.message)
    setEditing(null)
    await load()
  }

  if (!rows || rows.length === 0) return null
  const nominated = rows.filter((r) => r.nominated_at).length
  return (
    <section className="m-3.5 rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }} data-nominations>
      <h3 className="text-sm font-semibold">Nominations</h3>
      <p className="mt-0.5 text-xs text-ink-2">{nominated} of {rows.length} teams nominated. Set the division each plays in; unlock a squad if a club needs to change it.</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rows.map((e) => (
          <li key={e.entry_id} className="rounded-lg border p-2.5 text-sm" style={{ borderColor: 'var(--line-2)' }}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-medium">{e.name}{e.club ? <span className="font-normal text-ink-3"> · {e.club}</span> : null}</span>
                <span className="block text-xs text-ink-3">
                  in {e.division}{e.proposed_division && e.proposed_division !== e.division ? ` · proposed ${e.proposed_division}` : ''}
                  {e.nominated_at ? ` · nominated ${day(e.nominated_at)}` : ' · not nominated'}
                  {' · '}{e.players} players{e.locked ? ' · locked' : ''}
                  {e.outside_band > 0 ? <span style={{ color: 'var(--no)' }}> · {e.outside_band} outside the age band</span> : null}
                </span>
              </span>
              <span className="flex flex-none gap-1.5">
                {editing !== e.entry_id && (
                  <button onClick={() => { setEditing(e.entry_id); setDivision(e.proposed_division ?? e.division); setNote('') }} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                    Division
                  </button>
                )}
                {e.locked ? (
                  <button onClick={() => call('lock_entry_squad', { p_entry: e.entry_id, p_locked: false }, e.entry_id)} disabled={busy === e.entry_id} className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Unlock</button>
                ) : (
                  <button onClick={() => call('lock_entry_squad', { p_entry: e.entry_id, p_locked: true }, e.entry_id)} disabled={busy === e.entry_id} className="rounded-lg border px-2.5 py-1.5 text-xs disabled:opacity-50" style={{ borderColor: 'var(--line)' }}>Lock</button>
                )}
              </span>
            </div>
            {e.note && <p className="mt-1 text-xs text-ink-3">“{e.note}”</p>}
            {editing === e.entry_id && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <input value={division} onChange={(ev) => setDivision(ev.target.value)} placeholder="Division" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Division" />
                <input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="note to the club" className="min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: 'var(--line)' }} aria-label="Note" />
                <button onClick={() => call('set_entry_division', { p_entry: e.entry_id, p_division: division, p_note: note || undefined }, e.entry_id)} disabled={busy === e.entry_id || !division.trim()} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-50" style={{ background: 'var(--brand)' }}>Set</button>
                <button onClick={() => setEditing(null)} className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: 'var(--line)' }}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
    </section>
  )
}
