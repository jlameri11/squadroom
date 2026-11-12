'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'

/**
 * The feature switches (Joey, 10 Nov 2026; docs/SIMPLICITY.md; 0242).
 *
 * Core needs no switch: chat and notices, fixtures and availability, team
 * sheets and match sheets, registration and payments, roles, safeguarding,
 * branding, offline scores, "Message the club". Everything else is here,
 * with the one line Settings → Features shows. A switch is ON unless the
 * organisation turned it off; when it is off, nothing of the feature is
 * rendered — no empty tab, button or settings row (`<WhenOn>`, `useFeatures`).
 * The database holds only what is off (`features_off`, `set_feature`).
 */
export type FeatureKey =
  | 'player_of_match' | 'sponsors' | 'fixture_flowing' | 'development' | 'referee_self_appoint' | 'referee_pay'
  | 'training_slots' | 'trial_ratings' | 'duty_roster' | 'team_creator' | 'blue_cards' | 'ladder_breakdown'
  | 'find_a_club' | 'card_fee_passthrough' | 'active_kids' | 'scheduled_messages' | 'digest'
  | 'helpers' | 'match_photos' | 'kit' | 'match_video' | 'respect_marks' | 'polls' | 'scan'
  | 'club_health' | 'game_day' | 'accreditations' | 'role_requests' | 'bans' | 'registrations_csv'

export const FEATURES: { key: FeatureKey; label: string; what: string; builtYet?: false }[] = [
  { key: 'registrations_csv', label: 'Registrations spreadsheet', what: 'Download the registrations as a CSV with a column per question — the whole club or one program. For the staff and the Registrar.' },
  { key: 'bans', label: 'Bans', what: 'The club or the league bans a person for a period with a reason: no answering for games, no posting, no team sheet while it runs. On the Welfare screen and the league’s Discipline tab.' },
  { key: 'role_requests', label: 'Role requests', what: 'A member asks to be a coach, manager, volunteer, referee or committee member from Settings; the committee approves or declines under Requests. Nothing opens until they do.' },
  { key: 'accreditations', label: 'Coaching accreditation', what: 'Course certificates with dates on the Checks screen; the person and the club reminded thirty days out.' },
  { key: 'game_day', label: 'Game day (the Saturday view)', what: 'Every game today across the club by ground: called off, live, finished, squads short, nobody in charge, referees and team sheets missing.' },
  { key: 'club_health', label: 'Club health', what: 'One card for the committee: families joined per squad, squads with nobody in front of them, checks running out, PlayFootball not done.' },
  { key: 'player_of_match', label: 'Player of the Match', what: 'The coach picks one after a game; the squad’s families see it.' },
  { key: 'sponsors', label: 'Sponsors', what: 'Your sponsors on the match centre and the share cards. Squadroom takes nothing.' },
  { key: 'fixture_flowing', label: 'Fixture Flowing', what: 'A window in which a home club may move its own game before the draw locks.' },
  { key: 'development', label: 'Player stats and development notes', what: 'Coaches’ notes, ratings and clips on the player card; a family reads what is shared.' },
  { key: 'referee_self_appoint', label: 'Referee self-appointment', what: 'Referees take open games themselves instead of waiting to be appointed.' },
  { key: 'referee_pay', label: 'Referee pay tracker', what: 'What each referee is owed per game, and marking a run paid. Tracking only.' },
  { key: 'training_slots', label: 'Training-ground slots', what: 'Weekly training on a pitch or half-pitch: clashes and closed hours refused, the slot on the team page and in every session.' },
  { key: 'trial_ratings', label: 'Trial ratings and grading', what: 'Coaches rate players privately at a trial (1–5 and a note); the coordinator pencils teams and publishes them in one message per family.' },
  { key: 'duty_roster', label: 'Team duty rotation', what: 'Oranges, linesperson, kit wash — one family per duty per game, the fewest turns first, with swaps asked for in the chat.' },
  { key: 'team_creator', label: 'Team Creator', what: 'A captain enters a team of their own from the public page; once accepted they get a code, teammates join with it and pay their share (or the captain pays), and the team lives with the organiser.' },
  { key: 'blue_cards', label: 'Blue cards (sin bin)', what: 'Recorded on the match sheet with the minute shown and the minute back on, where a league turns them on in its discipline rules.' },
  { key: 'ladder_breakdown', label: 'Ladder breakdown', what: 'Tap a ladder row to see how every point was earned: each game with its points, forfeits named, the league’s adjustments with their reasons — on the league’s page and the public match centre.' },
  { key: 'find_a_club', label: 'Find a club', what: 'Be listed on Squadroom’s public Find a club page (by name or suburb) while you have something open to register for. Your suburb is set in Settings → Club.' },
  { key: 'card_fee_passthrough', label: 'Card-fee pass-through', what: 'Families pay the card processing fee, shown clearly before paying. Off by default.', builtYet: false },
  { key: 'active_kids', label: 'Active & Creative Kids vouchers', what: 'The NSW voucher at checkout ($50 off, once the club says it is a provider in Settings → Club), and the Treasurer’s list to redeem in Service NSW.' },
  { key: 'scheduled_messages', label: 'Scheduled messages', what: '“Send later…” in the composer: a message posted at a chosen time.' },
  { key: 'digest', label: 'Digest', what: 'Bundle ordinary chat into one notification every 10, 30 or 60 minutes.' },
  { key: 'helpers', label: 'Helpers wanted', what: 'Jobs on a game day — canteen, BBQ, linesman — that families put their hand up for.' },
  { key: 'match_photos', label: 'Game photos', what: 'The coach adds photos after a game; only the squad sees them, and any family can take one down.' },
  { key: 'kit', label: 'Kit list', what: 'Sizes per player and what to order.' },
  { key: 'match_video', label: 'Game video', what: 'A link or upload per played game, for the squad.' },
  { key: 'respect_marks', label: 'Respect marks', what: 'Behaviour marks after a game, for the league’s dashboard; never public.' },
  { key: 'polls', label: 'Polls', what: 'A question with options in a chat; members vote.' },
  { key: 'scan', label: 'Scan a draw', what: 'A screenshot of a fixture list read into the calendar.' },
]

const CACHE = new Map<string, Set<string>>()
const WAITERS = new Map<string, Set<(off: Set<string>) => void>>()

/** The switched-off features of an organisation; empty until known and when none are off. */
export function useFeatures(orgId?: string | null): { off: Set<string>; on: (key: FeatureKey) => boolean; loaded: boolean } {
  const org = orgId ?? getOrg()
  const [off, setOff] = useState<Set<string> | null>(() => (org ? (CACHE.get(org) ?? null) : null))
  useEffect(() => {
    if (!org) return
    const cached = CACHE.get(org)
    if (cached) {
      // Known already (another screen asked): apply it after this render,
      // not inside the effect itself (react-hooks/set-state-in-effect).
      let live = true
      queueMicrotask(() => { if (live) setOff(cached) })
      return () => {
        live = false
      }
    }
    let live = true
    const waiters = WAITERS.get(org) ?? new Set()
    waiters.add((o) => { if (live) setOff(o) })
    WAITERS.set(org, waiters)
    if (waiters.size === 1) {
      createClient().rpc('features_off', { p_academy: org }).then(({ data }) => {
        const set = new Set<string>((data as string[] | null) ?? [])
        CACHE.set(org, set)
        for (const w of WAITERS.get(org) ?? []) w(set)
        WAITERS.delete(org)
      })
    }
    return () => {
      live = false
    }
  }, [org])
  const set = off ?? new Set<string>()
  return { off: set, on: (key) => !set.has(key), loaded: off !== null }
}

/** After a switch is flipped, so every open screen re-reads. */
export function forgetFeatures(orgId?: string | null) {
  const org = orgId ?? getOrg()
  if (org) CACHE.delete(org)
}
