'use client'

import { useEffect, useState } from 'react'

/**
 * Which organisation the app is currently showing.
 *
 * `academies` means ORGANISATION — academy, club, league, school — and one
 * person can belong to several: a league secretary whose own child plays, a
 * coach at two clubs, an academy that also runs a gala day as its own
 * organising body. Every screen used to resolve this server-side by taking
 * the alphabetically first one, so those people saw one organisation and had
 * no route to the other.
 *
 * The choice lives in the browser rather than in a column on `profiles`, for
 * the reason set out in 0080: two tabs can be two organisations. On a
 * Saturday the person running the gala day is also the parent of a child
 * playing in it, and a single stored value makes those two tabs fight.
 *
 * It is a preference, never a permission. The id is passed to the screen
 * functions, which validate it against active membership and quietly fall
 * back to the person's default if it is not theirs — so editing it in devtools
 * achieves nothing.
 */

const KEY = 'squadroom.org'

// Mirrored in memory so a read during render never touches localStorage, and
// so the value survives a browser that refuses it (private windows do).
let current: string | null = null
let loaded = false

const listeners = new Set<(id: string | null) => void>()

export function getOrg(): string | null {
  if (!loaded) {
    loaded = true
    try {
      current = localStorage.getItem(KEY)
    } catch {
      current = null
    }
  }
  return current
}

export function setOrg(id: string | null) {
  current = id
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {}
  for (const fn of listeners) fn(id)
}

/**
 * The current organisation, re-rendering the caller when it changes.
 *
 * Read in the initialiser, not in an effect. Every screen builds its RPC
 * arguments from this and useScreen caches per argument list, so a hook that
 * returned null on the first render and an id on the second would make two
 * requests and show the wrong club's name in between — on every page load,
 * for the sake of a value that localStorage hands over synchronously.
 *
 * `typeof window` rather than a plain read because these components still
 * render on the server to produce the shell. Nothing about the markup depends
 * on the answer — only the arguments of a fetch that happens in the browser —
 * so there is nothing for hydration to disagree about.
 */
export function useOrg(): string | null {
  const [id, setId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : getOrg()
  )

  useEffect(() => {
    const fn = (next: string | null) => setId(next)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  return id
}

/**
 * Correct a remembered organisation that is no longer this person's.
 *
 * Every screen function returns the id it actually used, so when that does
 * not match what the browser asked for, the remembered value is stale — they
 * left the organisation, or were removed from it, and the server fell back to
 * their default. Writing the served id back stops the app asking for the dead
 * one on every screen for the rest of the session, and stops the switcher
 * ticking a row that is not showing.
 *
 * In an effect, not during render: setOrg notifies every useOrg subscriber,
 * and setting another component's state from inside a render is how you get
 * "Cannot update a component while rendering a different component".
 */
export function useReconcileOrg(served: string | null | undefined) {
  useEffect(() => {
    if (!served) return
    if (current && current !== served) setOrg(served)
  }, [served])
}
