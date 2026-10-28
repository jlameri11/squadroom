'use client'

import { useEffect, useState } from 'react'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { getOrg, setOrg } from '@/lib/org'
import { invalidateScreen } from '@/lib/hooks/use-screen'

type Org = {
  id: string
  name: string
  slug: string
  type: 'academy' | 'club' | 'league' | 'school' | 'other'
  role: 'owner' | 'admin' | 'coach' | 'parent' | 'player'
  primary_colour: string | null
  logo_url: string | null
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
    // my_organisations arrives with 0080; the generated types are built from
    // the deployed schema, which does not have it yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = createClient().rpc as any
    rpc('my_organisations').then(({ data }: { data: Org[] | null }) =>
      setOrgs(data ?? [])
    )
  }, [])

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
        <h2 className="display text-[22px] leading-tight">Switch organisation</h2>
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
              // No remembered choice means the server picked, and it picks the
              // alphabetically first — so that is the one showing.
              const on = current ? o.id === current : o.id === orgs[0]?.id
              return (
                <button
                  key={o.id}
                  onClick={() => (on ? onClose() : choose(o.id))}
                  className="flex items-center gap-3 rounded-xl border p-3 text-left"
                  style={{
                    borderColor: on ? 'var(--brand)' : 'var(--line)',
                    background: on ? 'var(--surface-2)' : 'var(--surface)',
                  }}
                >
                  <span
                    className="display grid h-10 w-10 flex-none place-items-center rounded-[11px] text-[15px] text-white"
                    style={{ background: o.primary_colour || 'var(--brand)' }}
                  >
                    {initials(o.name)}
                  </span>
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
      className="h-[66px] animate-pulse rounded-xl"
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
