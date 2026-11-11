import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Hat = Database['public']['Enums']['academy_role']

/** 0237's order (app_private.strongest_role): owner, admin, coach, parent, player. */
const RANK: Record<Hat, number> = { owner: 5, admin: 4, coach: 3, parent: 2, player: 1 }

/**
 * Give someone a hat in a club without taking one away (Joey, 11 Nov 2026).
 *
 * The trap this closes: writing `role` over an existing membership makes
 * 0237's sync trigger read it as a change of role — it swaps the old
 * strongest hat for the new one. A coach who is also a parent, approved for
 * a second child, stopped being the coach. So an existing member gets only
 * the union of their hats (the trigger then keeps `role` as the strongest);
 * a new member is inserted with the one hat.
 */
export async function addHat(
  admin: SupabaseClient<Database>,
  m: { academyId: string; profileId: string; hat: Hat; invitedBy?: string | null }
) {
  const { data: already } = await admin
    .from('academy_members')
    .select('roles')
    .eq('academy_id', m.academyId)
    .eq('profile_id', m.profileId)
    .maybeSingle()
  if (already) {
    const roles = Array.from(new Set<Hat>([...((already.roles ?? []) as Hat[]), m.hat]))
    return admin
      .from('academy_members')
      .update({ roles, status: 'active' })
      .eq('academy_id', m.academyId)
      .eq('profile_id', m.profileId)
  }
  return admin.from('academy_members').insert({
    academy_id: m.academyId,
    profile_id: m.profileId,
    role: m.hat,
    roles: [m.hat],
    status: 'active',
    invited_by: m.invitedBy ?? null,
  })
}

/**
 * Put someone on a squad, never lower than they already are there: a coach
 * of the squad who joins it as a parent stays its coach; a parent made its
 * coach is moved up.
 */
export async function joinTeam(
  admin: SupabaseClient<Database>,
  m: { academyId: string; teamId: string; profileId: string; role: Hat }
) {
  const { data: row } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', m.teamId)
    .eq('profile_id', m.profileId)
    .maybeSingle()
  if (row && RANK[row.role as Hat] >= RANK[m.role]) return { error: null }
  return admin
    .from('team_members')
    .upsert({ academy_id: m.academyId, team_id: m.teamId, profile_id: m.profileId, role: m.role }, { onConflict: 'team_id,profile_id' })
}
