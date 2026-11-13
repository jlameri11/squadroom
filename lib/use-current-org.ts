'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg, setOrg } from '@/lib/org'

export type CurrentOrg = {
  id: string
  name: string
  primary_colour: string
  timezone: string
  /** This person's role in it: owner, admin, coach, parent… */
  role: string
  userId: string
}

/**
 * The organisation the browser is showing, for a screen that needs its id
 * before it can fetch anything.
 *
 * Seven pages used to resolve this on the server as "the first academy by
 * name", which ignored the switcher completely: an owner of three
 * organisations opened Admin → Payments and got whichever sorted first —
 * for Joey, a stray organisation called "NRIFA" with no squads, while NRIFA
 * Football Academy's bills were unreachable. Only the browser knows which
 * organisation a person switched to (lib/org: two tabs can be two
 * organisations), so the choice is made here, from the remembered id if it
 * is one of this person's active memberships, else their first.
 *
 * `undefined` while resolving; a signed-out person goes to /signin and a
 * person in no organisation to /start, as the server pages used to send
 * them. A remembered id that is no longer theirs is corrected (setOrg), so
 * the switcher ticks the organisation that is actually showing.
 */
/**
 * One read per tab for everyone asking at once (the "Feels instant" pass):
 * the Admin hub and the shell both ask on the same screen, and the answer
 * does not change between them. Kept for the life of the tab, keyed by the
 * remembered organisation; the switcher calls setOrg, which changes the key.
 */
let shared: { key: string; p: Promise<CurrentOrg | null> } | null = null

async function resolveCurrentOrg(): Promise<CurrentOrg | null> {
  const supabase = createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const me = claims?.claims?.sub
  if (!me) {
    window.location.replace('/signin')
    return null
  }
  const { data: rows } = await supabase
    .from('academy_members')
    .select('role, academies(id, name, primary_colour, timezone)')
    .eq('profile_id', me)
    .eq('status', 'active')
  type Row = { role: string; academies: CurrentOrg | CurrentOrg[] | null }
  const mine = ((rows ?? []) as unknown as Row[])
    .map((r) => ({ role: r.role, academy: Array.isArray(r.academies) ? r.academies[0] : r.academies }))
    .filter((x): x is { role: string; academy: CurrentOrg } => Boolean(x.academy))
    .sort((x, y) => x.academy.name.localeCompare(y.academy.name))
  if (mine.length === 0) {
    window.location.replace('/start')
    return null
  }
  const wanted = getOrg()
  const pick = mine.find((x) => x.academy.id === wanted) ?? mine[0]
  if (pick.academy.id !== wanted) setOrg(pick.academy.id)
  return {
    id: pick.academy.id,
    name: pick.academy.name,
    primary_colour: pick.academy.primary_colour,
    timezone: pick.academy.timezone,
    role: pick.role,
    userId: me,
  }
}

export function useCurrentOrg(): CurrentOrg | undefined {
  const [org, setState] = useState<CurrentOrg | undefined>(undefined)

  useEffect(() => {
    let live = true
    const key = getOrg() ?? ''
    if (!shared || shared.key !== key) {
      const p = resolveCurrentOrg().catch(() => null)
      shared = { key, p }
      // A failed read is not kept: the next asker tries again.
      void p.then((v) => {
        if (v === null && shared?.p === p) shared = null
      })
    }
    void shared.p.then((v) => {
      if (live && v) setState(v)
    })
    return () => {
      live = false
    }
  }, [])

  return org
}
