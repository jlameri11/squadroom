'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { getOrg, setOrg } from '@/lib/org'
import { invalidateScreen } from '@/lib/hooks/use-screen'

/** A league or tournament the organisation runs (0246). */
type Comp = { id: string; name: string; season: string | null; status: string; type: string }

type Org = {
  id: string
  name: string
  slug: string
  type: 'academy' | 'club' | 'league' | 'school' | 'other'
  role: 'owner' | 'admin' | 'coach' | 'parent' | 'player'
  primary_colour: string | null
  logo_url: string | null
  competitions?: Comp[]
}

/**
 * Change which organisation the app is showing.
 *
 * Opened from the crest in the app bar, which is where a person looks to find
 * out whose app they are in. It only exists for people who belong to more
 * than one organisation — most do not, and a control that always says the
 * same thing is noise.
 *
 * The list shows what each organisation IS and what this person IS IN IT,
 * because those are the two things that disambiguate: "Hills Junior League ·
 * League · you run it" against "NRIFA · Academy · you coach". A name alone
 * does not distinguish a league from the academy that shares its suburb.
 */
export function OrgSwitcher({ onClose }: { onClose: () => void }) {
  const [orgs, setOrgs] = useState<Org[] | null>(null)
  const current = getOrg()

  useEffect(() => {
    // my_organisations (0080), each with the competitions it runs (0246), so
    // an organiser group — Magic Group → the SPL and its tournaments — shows
    // as the group with its leagues underneath.
    //
    // Called ON the client. This used to pull `rpc` off the client first
    // (`const rpc = createClient().rpc as any`), which detaches it from
    // `this` and throws "Cannot read properties of undefined (reading
    // 'rest')" before anything renders — found on 10 Nov 2026 by the first
    // suite to open the switcher. Nobody but Joey had two organisations.
    createClient()
      .rpc('my_organisations_with_competitions')
      .then(({ data }) => setOrgs((data as unknown as Org[] | null) ?? []))
  }, [])

  // The one showing: a remembered choice, else the server's pick (the
  // alphabetically first).
  function showing(id: string) {
    return current ? id === current : id === orgs?.[0]?.id
  }

  /**
   * Straight to one of the group's competitions. The competition screen
   * belongs to the organisation that runs it, so the app is switched to that
   * organisation first when it is not the one showing — the same full reload
   * as choose(), for the same reasons.
   */
  function openCompetition(orgId: string, competitionId: string) {
    const href = `/competitions/${competitionId}`
    if (showing(orgId)) {
      window.location.assign(href)
      return
    }
    setOrg(orgId)
    invalidateScreen()
    window.location.replace(href)
  }

  function choose(id: string) {
    setOrg(id)
    // Every cached screen belongs to the organisation it was fetched for.
    // Leaving them would show the previous club's chats and fixtures under
    // the new club's name until each one refetched — which is worse than a
    // skeleton, because it is wrong rather than absent.
    invalidateScreen()
    // A full reload rather than a router push. Realtime subscriptions, the
    // tab bar's counts and every open screen are all scoped to one
    // organisation, and reloading is the one way to be sure none of them is
    // still listening to the old one.
    //
    // replace rather than assign, so Back does not return to the previous
    // organisation's home screen with the new one's name on the bar.
    window.location.replace('/')
  }

  return (
    <Sheet onClose={onClose}>
      <div className="p-4">
        <h2 className="display text-[1.375rem] leading-tight">Switch organisation</h2>
        <p className="mt-0.5 text-sm text-ink-2">
          You&apos;re in {orgs?.length ?? '…'}. Chats, fixtures and teams all follow this choice.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {orgs === null ? (
            <>
              <Placeholder />
              <Placeholder />
            </>
          ) : (
            orgs.map((o) => {
              const on = showing(o.id)
              const comps = o.competitions ?? []
              return (
                <div key={o.id} className="flex flex-col gap-1">
                  <button
                    onClick={() => (on ? onClose() : choose(o.id))}
                    className="flex items-center gap-3 rounded-xl border p-3 text-left"
                    style={{
                      borderColor: on ? 'var(--brand)' : 'var(--line)',
                      background: on ? 'var(--surface-2)' : 'var(--surface)',
                    }}
                  >
                    {o.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a club's own file, any format
                      <img src={o.logo_url} alt="" className="h-10 w-10 flex-none rounded-[11px] border bg-white object-contain p-0.5" style={{ borderColor: 'var(--line)' }} data-club-logo />
                    ) : (
                      <span
                        className="display grid h-10 w-10 flex-none place-items-center rounded-[11px] text-[0.9375rem]"
                        style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}
                      >
                        {initials(o.name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{o.name}</span>
                      <span className="block truncate text-sm text-ink-3">
                        {label(o.type)} · {roleLabel(o.role)}
                      </span>
                    </span>
                    {on && (
                      <span className="flex-none text-lg" style={{ color: 'var(--brand-text)' }}>
                        ✓
                      </span>
                    )}
                  </button>
                  {/* What the organisation runs, underneath it (0246). Only an
                      organiser has any; a club's or academy's list is empty
                      and nothing shows. */}
                  {comps.length > 0 && (
                    <ul className="ml-[3.25rem] flex flex-col" data-org-competitions={o.id}>
                      {comps.map((c) => (
                        <li key={c.id}>
                          <button
                            onClick={() => openCompetition(o.id, c.id)}
                            className="tap flex w-full items-center gap-2 py-1.5 text-left text-sm"
                          >
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className="flex-none text-xs text-ink-3">
                              {c.status === 'ended' ? 'ended' : c.season ?? ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl border border-[var(--line)] px-4 py-3 font-medium"
        >
          Cancel
        </button>
      </div>
    </Sheet>
  )
}

function Placeholder() {
  return (
    <div
      className="h-[4.125rem] animate-pulse rounded-xl"
      style={{ background: 'var(--surface-2)' }}
      aria-hidden
    />
  )
}

/** Up to two initials, skipping the words nobody uses to tell clubs apart. */
function initials(name: string) {
  const skip = new Set(['the', 'of', 'and', 'fc', 'club', 'academy', 'league', 'junior'])
  const words = name
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()))
  return (words.length ? words : name.split(/\s+/))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

function label(type: Org['type']) {
  return type === 'other' ? 'Organisation' : type[0].toUpperCase() + type.slice(1)
}

/**
 * What this person does here, in their words.
 *
 * "Owner" is a database role; "you run it" is what it means. The distinction
 * matters in a switcher, where the whole job of the line is to tell two
 * similarly-named organisations apart.
 */
function roleLabel(role: Org['role']) {
  return {
    owner: 'you run it',
    admin: 'you administer it',
    coach: 'you coach',
    parent: 'your child plays',
    player: 'you play',
  }[role]
}
