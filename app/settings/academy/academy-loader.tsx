'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { ScreenSkeleton } from '@/components/screen-skeleton'
import { AcademySettings } from './academy-settings'
import { ClubBranding } from './club-branding'

type Academy = {
  id: string
  name: string
  type: string
  logo_url: string | null
  /** Arrives with 0209; undefined until then. */
  secondary_colour?: string | null
  /** Arrives with 0213 (replies to emailed notices); undefined until then. */
  contact_email?: string | null
  dm_policy: string
  directory_visibility: string
  primary_colour: string
  public_player_names: 'off' | 'initials' | 'full'
  sibling_discount_bps: number[] | null
  playfootball_fees_disclosed_season: string | null
  block_rsvp_when_overdue: boolean
  overdue_grace_days: number
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
          // `*`: secondary_colour arrives with 0209, and naming it before
          // then would fail the whole read.
          .select('*')
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
        <>
        <div className="mt-5">
          <ClubBranding
            academyId={academy.id}
            name={academy.name}
            kind={academy.type}
            primaryColour={academy.primary_colour}
            secondaryColour={academy.secondary_colour ?? null}
            logoUrl={academy.logo_url}
          />
        </div>
        <AcademySettings
          academyId={academy.id}
          dmPolicy={academy.dm_policy}
          directoryVisibility={academy.directory_visibility}
          publicPlayerNames={academy.public_player_names}
          siblingDiscountBps={academy.sibling_discount_bps ?? []}
          feesDisclosedSeason={academy.playfootball_fees_disclosed_season}
          blockRsvpWhenOverdue={academy.block_rsvp_when_overdue}
          overdueGraceDays={academy.overdue_grace_days}
          contactEmail={academy.contact_email === undefined ? undefined : academy.contact_email}
          twoStepRequired={(academy as { two_step_required?: boolean }).two_step_required}
          clubMode={(academy as { club_mode?: boolean }).club_mode}
          miniroosScores={(academy as { miniroos_scores?: boolean }).miniroos_scores}
          photoRequired={(academy as { photo_required?: boolean }).photo_required}
          activeKidsProvider={(academy as { active_kids_provider?: boolean }).active_kids_provider}
        />
        </>
      ) : (
        <p className="mt-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Only owners and admins can change these.
        </p>
      )}
    </div>
  )
}
