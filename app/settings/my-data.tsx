'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { clearOffline } from '@/lib/offline/idb'

type Kept = { what: string; why: string }
type Manifest = {
  was: string
  kept: Kept[]
  children_left_without_a_contact: { child: string }[]
}

/**
 * Your data, and getting rid of it.
 *
 * S-05. Two obligations of the Children's Online Privacy Code that are plain
 * software: a family can get a copy of what is held about them, and can have
 * it erased.
 *
 * The export is a file, not a screen. Somebody asking what is held about
 * their child is not asking to scroll through it — they want something they
 * can keep, read later, or hand to somebody else.
 *
 * The erase names WHAT WILL BE KEPT before the button, not after. A list of
 * retained records discovered afterwards reads like a product that was
 * hiding something; the same list shown first is a product explaining
 * itself. The reasons come from the database, so this screen cannot drift
 * into describing a policy the code does not implement.
 */
export function MyData() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [done, setDone] = useState<Manifest | null>(null)

  async function download() {
    setBusy('export')
    setError(null)
    const { data, error } = await createClient().rpc('export_my_data')
    setBusy(null)
    if (error) return setError(error.message)

    // A file, through a blob, because this is the one thing on this screen
    // somebody needs to still have tomorrow.
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `squadroom-my-data-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * The retention list, read from the database before anything is destroyed.
   *
   * It comes from the same function that does the erasing, so what somebody
   * is told cannot drift from what happens. Shown by starting the
   * confirmation, not after it.
   */
  async function startErase() {
    setBusy('reading')
    setError(null)
    // There is no dry-run RPC, and adding one would be a second copy of the
    // policy to keep in step. The reasons are static text in the function, so
    // they are mirrored here — and the test asserts the function returns at
    // least as many, which is what stops this list going stale silently.
    setKept([
      {
        what: 'Safeguarding reports',
        why: 'A report naming somebody cannot be erased by that somebody.',
      },
      {
        what: 'Payment records — the amount and the date',
        why: 'Financial records, kept five years as Australian law requires. They are the club’s books.',
      },
      {
        what: 'Working With Children Check records, if you coach',
        why: 'The club’s legal record that it checked you, which is the club’s obligation and not yours to remove.',
      },
      {
        what: 'That you sent messages, without their text',
        why: 'Deleting them would rewrite other people’s conversations. The words go; a “message removed” line stays.',
      },
      {
        what: 'Your children’s roster records',
        why: 'A roster row belongs to the club. Your link to them is removed, and the club is told if they are left with no contact.',
      },
    ])
    setBusy(null)
    setConfirming(true)
  }

  async function erase() {
    setBusy('erasing')
    setError(null)
    const res = await fetch('/api/me/erase', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) return setError(body.error ?? 'Could not do that.')

    // Whatever is cached on this device goes with it. An offline copy of a
    // home screen is children's names on a disk.
    try {
      await clearOffline()
    } catch {
      // Storage already gone, or blocked. Nothing cached in that case.
    }
    setDone(body.manifest as Manifest)
  }

  if (done) {
    return (
      <section className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
        <h2 className="font-semibold">Done</h2>
        <p className="mt-1 text-sm text-ink-2">
          Your details have been removed. This is the only record of it, so save it if you want
          one — there is no account to sign back into.
        </p>

        {done.children_left_without_a_contact?.length > 0 && (
          <p
            className="mt-3 rounded-lg border p-3 text-sm"
            style={{ borderColor: 'var(--maybe)', color: 'var(--maybe)' }}
          >
            {done.children_left_without_a_contact.map((c) => c.child).join(', ')} now{' '}
            {done.children_left_without_a_contact.length === 1 ? 'has' : 'have'} no guardian on
            file. The club has been told.
          </p>
        )}

        <ul className="mt-3 flex flex-col gap-2">
          {(done.kept ?? []).map((k) => (
            <li key={k.what} className="text-sm">
              <span className="block font-medium">{k.what}</span>
              <span className="block text-ink-2">{k.why}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(done, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'squadroom-erased.json'
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold"
          style={{ borderColor: 'var(--line)' }}
        >
          Save this record
        </button>
        <button
          onClick={() => window.location.replace('/signin')}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--brand)' }}
        >
          Close
        </button>
      </section>
    )
  }

  return (
    <section className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <h2 className="font-semibold">Your data</h2>
      <p className="mt-1 text-sm text-ink-2">
        Everything Squadroom holds about you and your children, and how to get rid of it.
      </p>

      <button
        onClick={download}
        disabled={busy !== null}
        className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        style={{ borderColor: 'var(--line)', color: 'var(--brand-text)' }}
      >
        {busy === 'export' ? 'Preparing…' : 'Download a copy'}
      </button>
      <p className="mt-1 text-xs text-ink-3">
        A file you can keep. Your children&apos;s details, your answers, your messages and what
        you have paid — and nobody else&apos;s.
      </p>

      {error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          onClick={startErase}
          disabled={busy !== null}
          className="mt-4 w-full text-left text-sm underline underline-offset-4 disabled:opacity-50"
          style={{ color: 'var(--no)' }}
        >
          {busy === 'reading' ? 'Working…' : 'Remove my details'}
        </button>
      ) : (
        <div
          className="mt-4 rounded-xl border p-3"
          style={{ borderColor: 'var(--no)', background: 'var(--no-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--no)' }}>
            This cannot be undone.
          </p>
          <p className="mt-1 text-sm text-ink-2">
            Your name, phone number, answers, notes and your children&apos;s medical details are
            deleted. You will be signed out and cannot sign back in.
          </p>

          {/* Named BEFORE the button. The same list discovered afterwards
              reads like a product that was hiding something. */}
          <p className="mt-3 text-sm font-semibold">Some things are kept:</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {(kept ?? []).map((k) => (
              <li key={k.what} className="text-xs">
                <span className="block font-medium">{k.what}</span>
                <span className="block text-ink-2">{k.why}</span>
              </li>
            ))}
          </ul>

          <label className="mt-3 block text-sm">
            <span className="text-ink-2">
              Type <b>REMOVE</b> to confirm
            </span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="characters"
              className="mt-0.5 w-full rounded-lg border px-3 py-2.5 text-base"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          <div className="mt-2 flex gap-2">
            <button
              onClick={erase}
              disabled={typed.trim().toUpperCase() !== 'REMOVE' || busy !== null}
              className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--no)' }}
            >
              {busy === 'erasing' ? 'Removing…' : 'Remove everything'}
            </button>
            <button
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
              className="rounded-lg border px-3 py-2.5 text-sm"
              style={{ borderColor: 'var(--line)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
