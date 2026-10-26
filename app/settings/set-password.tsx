'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Setting a password, which there was no way to do.
 *
 * The hole was a loop with no exit. You arrive by emailed link or, as a
 * parent, by a join code and a coach's approval — and neither of those ever
 * asks you to choose a password. So the moment you sign out, the only way
 * back in is another emailed link, and Supabase's built-in mailer allows
 * roughly two messages an hour ACROSS THE WHOLE PROJECT: two coaches signing
 * in on a Saturday lock each other out, and a parent on a join-code account
 * has no email that can receive anything at all.
 *
 * A password needs no mail server, no Twilio and no waiting, and the sign-in
 * screen already defaults to one. This is the piece that was missing.
 *
 * Offered unconditionally rather than only to people who have none. Whether
 * an account has a password is in auth.users and readable only by the service
 * role, and a round trip to a privileged route to decide whether to render a
 * form is more moving parts than the form.
 */
export function SetPassword() {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Supabase's own minimum is six. Eight is not much to ask of somebody with
  // access to a channel full of children's names, and saying the rule before
  // they type beats rejecting them after.
  const tooShort = password.length > 0 && password.length < 8
  const mismatch = again.length > 0 && password !== again
  const ready = password.length >= 8 && password === again

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await createClient().auth.updateUser({ password })
    setBusy(false)
    if (error) {
      return setError(
        /same.*password/i.test(error.message)
          ? 'That is already your password.'
          : error.message
      )
    }
    setPassword('')
    setAgain('')
    setDone(true)
  }

  if (!open) {
    return (
      <section className="mt-8 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
        <h2 className="font-semibold">Password</h2>
        <p className="mt-1 text-sm text-ink-2">
          Set one and you can sign in straight away next time, instead of waiting for an email.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--brand)' }}
        >
          Set a password
        </button>
      </section>
    )
  }

  if (done) {
    return (
      <section className="mt-8 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
        <h2 className="font-semibold">Password set</h2>
        <p className="mt-1 text-sm text-ink-2">
          Next time, sign in with your email and this password — no link, no waiting.
        </p>
        <button
          onClick={() => {
            setDone(false)
            setOpen(false)
          }}
          className="mt-3 text-sm underline underline-offset-4 text-ink-2"
        >
          Change it again
        </button>
      </section>
    )
  }

  return (
    <section className="mt-8 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
      <h2 className="font-semibold">Set a password</h2>
      <p className="mt-1 text-sm text-ink-2">
        At least 8 characters. You&apos;ll use it with your email address.
      </p>

      <div className="mt-3 flex flex-col gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // So a password manager offers to save it, and does not offer the
            // CURRENT one as a suggestion.
            autoComplete="new-password"
            className="rounded-xl border px-3.5 py-3 text-base"
            style={{ borderColor: tooShort ? 'var(--no)' : 'var(--line)' }}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="eyebrow">Again</span>
          <input
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            className="rounded-xl border px-3.5 py-3 text-base"
            style={{ borderColor: mismatch ? 'var(--no)' : 'var(--line)' }}
          />
        </label>

        {/* Said while they type, not after they submit. */}
        {tooShort && (
          <p className="text-sm" style={{ color: 'var(--no)' }}>
            {8 - password.length} more character{8 - password.length === 1 ? '' : 's'}.
          </p>
        )}
        {mismatch && (
          <p className="text-sm" style={{ color: 'var(--no)' }}>
            Those two don&apos;t match.
          </p>
        )}
        {error && (
          <p
            className="rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--no-bg)', color: 'var(--no)' }}
          >
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!ready || busy}
            className="flex-1 rounded-xl px-4 py-3 font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--brand)' }}
          >
            {busy ? 'Saving…' : 'Save password'}
          </button>
          <button
            onClick={() => {
              setOpen(false)
              setPassword('')
              setAgain('')
              setError(null)
            }}
            className="rounded-xl border px-4 py-3 font-medium"
            style={{ borderColor: 'var(--line)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </section>
  )
}
