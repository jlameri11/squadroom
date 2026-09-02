'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { contacts, normalisePhone } from '@/lib/adapters/contacts'

type Row = { player: string; parent: string; phone: string }

const blank = (): Row => ({ player: '', parent: '', phone: '' })

/**
 * Adding a player, and the parent who comes with them.
 *
 * A player and a guardian are one thought for a coach — "Leo Whitfield, mum
 * is Sarah, here's her number" — and splitting them across two screens is how
 * a squad ends up half-entered with nobody attached to anyone. So this takes
 * both, and the contact picker fills the parent half from the phone the coach
 * already has the number in.
 *
 * The privacy shape from lib/adapters/contacts is not relaxed here. The OS
 * shows its own picker, one contact comes back, and the rest of the address
 * book is never read. A coach's phone holds their doctor and their ex, and
 * none of that belongs on a football server.
 *
 * A parent is optional. Half a squad list arrives before anyone has numbers,
 * and a player with nobody attached is a normal state for the first month of
 * a season — not an error to block on.
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
  const [rows, setRows] = useState<Row[]>([blank()])
  const [canPick, setCanPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Whether a picker exists is a question about the device, so it can only be
  // answered in the browser. A button that does nothing on an iPhone is worse
  // than no button.
  useEffect(() => setCanPick(contacts.isSupported()), [])

  const known = new Set(existing.map((n) => n.trim().toLowerCase()))
  const ready = rows.filter(
    (r) => r.player.trim() && !known.has(r.player.trim().toLowerCase())
  )
  const dupes = rows.filter((r) => r.player.trim() && known.has(r.player.trim().toLowerCase()))

  function set(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  }

  async function pickParent(i: number) {
    const chosen = await contacts.pick()
    if (chosen.length === 0) return
    // Straight into the row, not into the database. Nothing is sent until the
    // coach presses Add, and they can see exactly what they picked.
    set(i, { parent: chosen[0].name, phone: chosen[0].phone })
  }

  async function add() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()

    const { data: made, error: playerError } = await supabase
      .from('players')
      .insert(ready.map((r) => ({ academy_id: academyId, team_id: teamId, full_name: r.player.trim() })))
      .select('id, full_name')

    if (playerError) {
      setBusy(false)
      return setError(playerError.message)
    }

    // Invites for whoever came with a number. Deliberately after the players
    // exist: a squad entered with no invite sent is recoverable, an invite to
    // a parent whose child is not in the system is confusing.
    const invites = ready
      .map((r) => ({ ...r, phone: normalisePhone(r.phone) }))
      .filter((r) => r.phone !== '')
      .map((r) => ({
        academy_id: academyId,
        phone: r.phone,
        full_name: r.parent.trim() || null,
        role: 'parent' as const,
        invited_by: auth.user!.id,
      }))

    if (invites.length > 0) {
      const { error: inviteError } = await supabase.from('invites').insert(invites)
      if (inviteError && inviteError.code !== '23505') {
        setBusy(false)
        return setError(
          `${made?.length ?? 0} players added, but the invites failed: ${inviteError.message}`
        )
      }
    }

    setBusy(false)
    setRows([blank()])
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
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl p-5"
        style={{ background: 'var(--surface)' }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
        <h2 className="display text-xl">Add players</h2>
        <p className="mt-1 text-sm text-ink-2">
          The child, and the parent who should get the invite.
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={i} className="rounded-xl border border-[var(--line)] p-3">
              <input
                value={r.player}
                onChange={(e) => set(i, { player: e.target.value })}
                placeholder="Player's name"
                autoFocus={i === 0}
                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 font-medium"
              />

              <div className="mt-2 flex gap-2">
                <input
                  value={r.parent}
                  onChange={(e) => set(i, { parent: e.target.value })}
                  placeholder="Parent's name"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm"
                />
                <input
                  value={r.phone}
                  onChange={(e) => set(i, { phone: e.target.value })}
                  placeholder="Mobile"
                  inputMode="tel"
                  className="w-32 flex-none rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm"
                />
              </div>

              {canPick && (
                <button
                  onClick={() => pickParent(i)}
                  className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium"
                >
                  Choose parent from contacts
                </button>
              )}

              {rows.length > 1 && (
                <button
                  onClick={() => setRows(rows.filter((_, n) => n !== i))}
                  className="mt-2 text-xs text-ink-3"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        <button
          onClick={() => setRows([...rows, blank()])}
          className="mt-3 w-full rounded-xl border border-dashed border-[var(--line)] px-3 py-2.5 text-sm font-medium text-ink-2"
        >
          Add another player
        </button>

        {!canPick && (
          <p className="mt-3 text-xs text-ink-3">
            Your phone&apos;s contact picker isn&apos;t available in this browser — Safari has none.
            Type the number, or use the installed app.
          </p>
        )}

        {dupes.length > 0 && (
          <p className="mt-3 text-xs" style={{ color: 'var(--maybe)' }}>
            {dupes.map((d) => d.player).join(', ')} {dupes.length === 1 ? 'is' : 'are'} already in
            this squad and will be skipped.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <p className="mt-3 text-xs text-ink-3">
          Only the contacts you tap are read — the rest of your address book is never uploaded.
          Parents still approve nothing: they get an invite, and you approve them.
        </p>

        <div className="mt-4 flex gap-2">
          <button onClick={add} disabled={busy || ready.length === 0} className="btn flex-1 disabled:opacity-50">
            {busy ? 'Adding…' : ready.length ? `Add ${ready.length}` : 'Add a name first'}
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-quiet">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
