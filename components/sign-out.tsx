'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { setOrg } from '@/lib/org'
import { invalidateScreen } from '@/lib/hooks/use-screen'
import { clearOffline } from '@/lib/offline/idb'

/**
 * Signing out, which was not possible at all.
 *
 * There was no sign-out anywhere in the product. A coach could not hand their
 * phone to a colleague, a parent could not get out of an account they were
 * approved into by mistake, and nobody could switch between two accounts on
 * one device without clearing site data by hand.
 *
 * FOUR THINGS HAVE TO GO, not one. The session is the obvious one. The other
 * three are what make this a correctness problem rather than a missing
 * button:
 *
 *   · The remembered ORGANISATION (lib/org.ts) lives in localStorage and
 *     survives a sign-out. Leave it, and the next person to sign in on this
 *     device lands in the previous person's club — and if they are not a
 *     member of it the server falls back to their own, so it half-works,
 *     which is worse than failing.
 *
 *   · The screen CACHE (use-screen) and the tab bar's counts are
 *     module-level, so they outlive a client-side navigation. A reload
 *     clears them, which is why this finishes with location.replace rather
 *     than a router push — and replace, not assign, so Back does not return
 *     to a signed-in screen.
 *
 *   · And since X-09, what is on DISK. A cached home screen is somebody's
 *     children's names and their fixtures, held in IndexedDB so a ground
 *     with no signal still shows them — which also means it outlives a
 *     reload, a sign-out and the device being handed on. The outbox goes
 *     with it: a queued write belongs to the session that made it, and
 *     replaying it as the next person is how "who marked this child
 *     present" gets the wrong answer.
 *
 * The remembered sign-in EMAIL is deliberately kept. It is not a secret, the
 * password still is, and a coach signing back in on their own phone should
 * not have to retype their address.
 */
export function SignOut({ variant = 'row' }: { variant?: 'row' | 'button' }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function out() {
    setBusy(true)
    setOrg(null)
    invalidateScreen()
    // Awaited, unlike the rest. The redirect below reloads the page, and a
    // clear that is still running when that happens leaves the previous
    // person's children on the disk.
    try {
      await clearOffline()
    } catch {
      // Storage can be blocked or already gone. Signing out still has to
      // work; there is nothing cached in that case anyway.
    }
    try {
      await createClient().auth.signOut()
    } catch {
      // A failed sign-out must still leave. If the network is down the local
      // session is already gone from this client, and staying on a screen
      // that cannot load is not a kindness.
    }
    window.location.replace('/signin')
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className={
          variant === 'button'
            ? 'w-full rounded-xl border px-4 py-3 text-sm font-semibold'
            : 'w-full px-4 py-3.5 text-left text-sm font-medium'
        }
        style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
      >
        Sign out
      </button>
    )
  }

  return (
    <div className="p-3">
      {/*
        Asked here because this is the moment it matters. Somebody who
        arrived by emailed link has no password, and the only way back in is
        another email — Supabase's own mailer allows about two an hour for the
        whole project, and a join-code parent has no address that can receive
        one at all. Better to say so before they leave than after.
      */}
      <p className="mb-2 text-xs text-ink-3">
        Make sure you&apos;ve set a password in{' '}
        <a href="/settings" className="underline underline-offset-2">
          Your details
        </a>
        , or you&apos;ll need another emailed link to get back in.
      </p>
      <div className="flex gap-2">
      <button
        onClick={out}
        disabled={busy}
        className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--no)' }}
      >
        {busy ? 'Signing out…' : 'Yes, sign out'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: 'var(--line)' }}
      >
        Stay
      </button>
      </div>
    </div>
  )
}
