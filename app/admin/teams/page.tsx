import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { NewTeam } from './new-team'

/**
 * Teams in the organisation.
 *
 * Note there is no API route behind any of this. Creating a team is a plain
 * insert from the browser, and the policy on `teams` already says only staff
 * may do it. That is the whole point of putting authorisation in the
 * database: the client can be honest about what it is doing, because lying
 * gets it nothing.
 */
export default async function TeamsPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: academies } = await supabase.from('academies').select('id, name').order('name')
  const academy = academies?.[0]
  if (!academy) redirect('/start')

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, age_group, season, status, team_members(count), players(count)')
    .eq('academy_id', academy.id)
    .order('age_group')

  return (
    <main className="mx-auto max-w-md p-5">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Teams</h1>
        <p className="mt-1 text-sm text-neutral-500">{academy.name}</p>
      </header>

      <div className="flex flex-col gap-2">
        {(teams ?? []).map((t) => (
          <Link
            key={t.id}
            href={`/admin/teams/${t.id}`}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4"
          >
            <span
              className="grid h-10 w-10 flex-none place-items-center rounded-lg text-sm font-bold text-white"
              style={{ background: t.status === 'active' ? '#202842' : '#9CA3AF' }}
            >
              {t.age_group}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{t.name}</span>
              <span className="block text-sm text-neutral-500">
                {countOf(t.players)} players · {countOf(t.team_members)} members · {t.season}
                {t.status === 'ended' && ' · ended'}
              </span>
            </span>
          </Link>
        ))}

        {(teams ?? []).length === 0 && (
          <p className="rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
            No teams yet. Create one and its channel appears automatically.
          </p>
        )}
      </div>

      <NewTeam academyId={academy.id} />
    </main>
  )
}

/** PostgREST returns aggregate counts as [{count: n}]. */
function countOf(rel: unknown): number {
  if (Array.isArray(rel)) return (rel[0] as { count?: number } | undefined)?.count ?? 0
  return (rel as { count?: number } | null)?.count ?? 0
}
