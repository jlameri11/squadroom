'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { invalidateScreen } from '@/lib/hooks/use-screen'
import { contacts, type PickedContact } from '@/lib/adapters/contacts'

type Draft = { name: string; phone: string; problem?: string }

/**
 * Adding people to the club, the two ways a coach actually has them.
 *
 * Either they are already in the coach's phone — the parent who has been
 * texting them all season — or they are standing in front of them and the
 * coach is typing. Both end in the same review screen and the same route.
 *
 * THE PICKER RETURNS ONLY WHAT WAS TAPPED. There is no "read the address
 * book" call anywhere in this product and there must never be: a coach's
 * phone holds their doctor, their ex, their kids' friends' parents, and
 * uploading that wholesale is a Privacy Act problem and the kind of thing
 * that ends a product built around other people's children. The adapter's
 * shape enforces it — `pick()` resolves to a selection, and nothing is sent
 * until the review screen below is confirmed.
 *
 * What this creates is PRESENCE, not ACCESS. They appear in the directory so
 * the club can ring them; they get no session and no password, and their
 * address is a synthetic one that can never receive anything. To actually
 * sign in they still come through a join code and an approval.
 */
export function AddContact({
  academyId,
  teams,
  canAddStaff,
  onClose,
  onAdded,
}: {
  academyId: string
  teams: { id: string; name: string }[]
  canAddStaff: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([{ name: '', phone: '' }])
  const [role, setRole] = useState<'parent' | 'coach'>('parent')
  const [teamId, setTeamId] = useState('')
  const [canPick, setCanPick] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<{ name: string; reused: boolean }[] | null>(null)

  // Checked, not assumed. The Contact Picker API is Chrome-on-Android only —
  // Safari has no equivalent and Apple has given no sign it will — so on an
  // iPhone this button must not exist rather than existing and failing.
  useEffect(() => {
    // Inside an async call rather than straight from the effect body, which
    // reads to the linter as a cascading render — the same shape every other
    // screen here uses.
    ;(async () => {
      setCanPick(contacts.isSupported())
    })()
  }, [])

  async function pick() {
    setError(null)
    try {
      const picked: PickedContact[] = await contacts.pick()
      if (picked.length === 0) return
      setDrafts(
        picked.map((c) => ({
          name: c.name,
          phone: c.phone,
          problem: c.phone ? undefined : 'no mobile number on that contact',
        }))
      )
    } catch {
      setError('Your phone would not share those contacts.')
    }
  }

  const ready = drafts.filter((d) => d.name.trim() && d.phone.trim() && !d.problem)

  async function save() {
    setBusy(true)
    setError(null)
    const results: { name: string; reused: boolean }[] = []

    // One at a time, because each is a separate account and a failure on the
    // fourth must not undo the three before it. The review screen reports
    // what happened to each.
    for (const d of ready) {
      const response = await fetch('/api/contacts/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          academyId,
          fullName: d.name.trim(),
          phone: d.phone.trim(),
          role,
          teamId: teamId || undefined,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setBusy(false)
        return setError(`${d.name}: ${payload?.error ?? 'could not be added'}`)
      }
      results.push({ name: payload.name, reused: payload.reused })
    }

    setBusy(false)
    invalidateScreen()
    setAdded(results)
  }

  if (added) {
    return (
      <Sheet onClose={onClose}>
        <div className="p-4">
          <h2 className="display text-[22px] leading-tight">
            {added.length} {added.length === 1 ? 'person' : 'people'} added
          </h2>
          <ul className="mt-3 flex flex-col gap-1">
            {added.map((a, i) => (
              <li key={i} className="text-sm">
                <b>{a.name}</b>
                {a.reused && <span className="text-ink-3"> — was already in the club</span>}
              </li>
            ))}
          </ul>
          {/* Said here because a coach will otherwise wonder why the person
              cannot log in. */}
          <p className="mt-3 rounded-lg p-2.5 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            They are in the directory now, so the club can reach them. To sign
            in themselves they still need your team&apos;s join code — adding
            somebody does not hand out an account.
          </p>
          <button
            onClick={() => {
              onAdded()
              onClose()
            }}
            className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white"
            style={{ background: 'var(--brand)' }}
          >
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[22px] leading-tight">Add someone</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          For the parent with no smartphone, or the grandparent who does the Saturday driving.
        </p>

        {canPick && (
          <button
            onClick={pick}
            className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold"
            style={{ borderColor: 'var(--line)', color: 'var(--brand)' }}
          >
            Pick from my phone&apos;s contacts
          </button>
        )}

        <div className="mt-3 flex flex-col gap-2.5">
          {drafts.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={d.name}
                onChange={(e) => {
                  const next = [...drafts]
                  next[i] = { ...next[i], name: e.target.value }
                  setDrafts(next)
                }}
                placeholder="Name"
                className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              />
              <input
                value={d.phone}
                onChange={(e) => {
                  const next = [...drafts]
                  next[i] = { ...next[i], phone: e.target.value, problem: undefined }
                  setDrafts(next)
                }}
                placeholder="04…"
                inputMode="tel"
                className="min-w-0 flex-1 rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: d.problem ? 'var(--no)' : 'var(--line)' }}
              />
            </div>
          ))}
          {drafts.some((d) => d.problem) && (
            <p className="text-xs" style={{ color: 'var(--no)' }}>
              A mobile number is needed — it is how the club reaches them and how they join later.
            </p>
          )}
          <button
            onClick={() => setDrafts([...drafts, { name: '', phone: '' }])}
            className="self-start text-sm underline underline-offset-4 text-ink-2"
          >
            Add another
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {canAddStaff && (
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow">They are a</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'parent' | 'coach')}
                className="rounded-xl border px-3 py-3 text-base"
                style={{ borderColor: 'var(--line)' }}
              >
                <option value="parent">Parent</option>
                <option value="coach">Coach</option>
              </select>
            </label>
          )}
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="eyebrow">Squad</span>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="rounded-xl border px-3 py-3 text-base"
              style={{ borderColor: 'var(--line)' }}
            >
              <option value="">Club-wide only</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p
            className="mt-3 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        <button
          onClick={save}
          disabled={busy || ready.length === 0}
          className="mt-4 w-full rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--brand)' }}
        >
          {busy
            ? 'Adding…'
            : ready.length === 0
              ? 'Add a name and a number'
              : `Add ${ready.length} ${ready.length === 1 ? 'person' : 'people'}`}
        </button>
      </div>
    </Sheet>
  )
}
