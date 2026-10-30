'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { AcademySettings } from './academy-settings'

type Academy = {
  id: string
  name: string
  dm_policy: string
  directory_visibility: string
  primary_colour: string
  public_player_names: 'off' | 'initials' | 'full'
  sibling_discount_bps: number[] | null
  playfootball_fees_disclosed_season: string | null
}

/**
 * Which club's settings. The organisation the browser is showing (lib/org),
 * then its row and the caller's role in it.
 *
 * The page used to take "the first academy by name" on the server, and for
 * an owner of several that was a stray organisation called "NRIFA" with no
 * squads — so the colours, phone policy and family discounts on this screen
 * belonged to a club nobody uses, and the ones for NRIFA Football Academy
 * were unreachable. Only the browser knows which organisation a person has
 * switched to, so the choice is made here.
 */
export function AcademyLoader() {
  const [academy, setAcademy] = useState<Academy | null | undefined>(undefined)
  const [isStaff, setIsStaff] = useState(false)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: claims } = await supabase.auth.getClaims()
      const me = claims?.claims?.sub
      if (!me) return setAcademy(null)
      let org = getOrg()
      if (!org) {
        const { data: m } = await supabase.from('academy_members').select('academy_id').eq('status', 'active').limit(1).maybeSingle()
        org = m?.academy_id ?? null
      }
      if (!org) return setAcademy(null)
      const [{ data: a }, { data: member }] = await Promise.all([
        supabase
          .from('academies')
          .select('id, name, dm_policy, directory_visibility, primary_colour, public_player_names, sibling_discount_bps, playfootball_fees_disclosed_season')
          .eq('id', org)
          .maybeSingle(),
        supabase.from('academy_members').select('role').eq('academy_id', org).eq('profile_id', me).eq('status', 'active').maybeSingle(),
      ])
      setIsStaff(member?.role === 'owner' || member?.role === 'admin')
      setAcademy((a as Academy | null) ?? null)
    })()
  }, [])

  if (academy === undefined) return <ScreenSkeleton />
  if (academy === null) {
    return <p className="p-6 text-center text-sm text-ink-2">You are not in a club yet.</p>
  }

  return (
    <div className="p-4">
      <p className="mt-1 text-sm text-ink-2">{academy.name}</p>
      {isStaff ? (
        <AcademySettings
          academyId={academy.id}
          dmPolicy={academy.dm_policy}
          primaryColour={academy.primary_colour}
          academyName={academy.name}
          directoryVisibility={academy.directory_visibility}
          publicPlayerNames={academy.public_player_names}
          siblingDiscountBps={academy.sibling_discount_bps ?? []}
          feesDisclosedSeason={academy.playfootball_fees_disclosed_season}
        />
      ) : (
        <p className="mt-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Only owners and admins can change these.
        </p>
      )}
    </div>
  )
}
