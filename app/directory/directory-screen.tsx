'use client'

import { useEffect, useState } from 'react'
import { AddContact } from './add-contact'
import { DirectoryList } from './directory-list'
import { AppBar, Screen } from '@/components/app-shell'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { createClient } from '@/lib/supabase/client'

type Person = {
  profile_id: string
  full_name: string
  avatar_url: string | null
  role: string
  phone: string | null
  teams: string[] | null
}

/**
 * Three calls, in parallel, from a browser that is milliseconds from the
 * database — rather than four in sequence from a server that is not.
 *
 * It would be one call if there were a directory_screen() function to add,
 * and there should be; this is the same shape as home_screen and chat_screen
 * and wants folding in next time migrations are available.
 */
export function DirectoryScreen() {
  const [state, setState] = useState<{
    academy: { id: string; name: string; dm_policy: string }
    me: string
    isStaff: boolean
    people: Person[]
    teams: { id: string; name: string }[]
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let live = true
    const supabase = createClient()

    ;(async () => {
      const { data: claims } = await supabase.auth.getClaims()
      const me = claims?.claims?.sub
      if (!me) {
        window.location.replace('/signin')
        return
      }

      const { data: academies } = await supabase
        .from('academies')
        .select('id, name, dm_policy')
        .order('name')
      const academy = academies?.[0]
      if (!academy) {
        window.location.replace('/start')
        return
      }

      // Real team rows, because adding somebody to a squad needs its id —
      // the names already in the directory are not ids, and passing one
      // would fail a foreign key at the end of a form somebody has filled in.
      const [{ data: people }, { data: badges }, { data: teams }] = await Promise.all([
        supabase.rpc('member_directory', { p_academy: academy.id }),
        supabase.rpc('nav_badges'),
        supabase
          .from('teams')
          .select('id, name')
          .eq('academy_id', academy.id)
          .eq('status', 'active')
          .order('name'),
      ])

      if (!live) return
      if (!people) return setFailed(true)

      setState({
        academy,
        me,
        isStaff: (badges as { is_staff?: boolean } | null)?.is_staff ?? false,
        people: people as Person[],
        teams: teams ?? [],
      })
    })()

    return () => {
      live = false
    }
  }, [])

  if (failed) {
    return (
      <div className="mx-auto grid min-h-dvh w-full max-w-md place-items-center p-6">
        <p className="text-center text-sm text-ink-2">Couldn&apos;t load the directory.</p>
      </div>
    )
  }
  if (!state) return <ScreenSkeleton />

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
      <AppBar
        title="Directory"
        meta={`${state.people.length} people · ${state.academy.name}`}
        action={
          state.isStaff && (
            <button
              onClick={() => setAdding(true)}
              className="flex-none rounded-[10px] px-3 py-1.5 text-sm font-semibold"
              style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
            >
              Add
            </button>
          )
        }
      />
      <Screen>
        <div className="p-4">
          <DirectoryList
            academyId={state.academy.id}
            myId={state.me}
            iAmStaff={state.isStaff}
            dmPolicy={state.academy.dm_policy}
            people={state.people.map((p) => ({
              id: p.profile_id,
              name: p.full_name,
              avatarUrl: p.avatar_url,
              role: p.role,
              phone: p.phone,
              teams: p.teams ?? [],
            }))}
          />
        </div>
      </Screen>

      {adding && (
        <AddContact
          academyId={state.academy.id}
          teams={state.teams}
          canAddStaff={state.isStaff}
          onClose={() => setAdding(false)}
          onAdded={() => window.location.reload()}
        />
      )}
    </div>
  )
}
