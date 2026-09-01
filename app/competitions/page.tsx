import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function CompetitionsPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  // RLS returns competitions you organise or your club has entered.
  const { data: comps } = await supabase
    .from('competitions')
    .select('id, name, type, season, organiser, starts_on, ends_on, status, organiser_id, academies!competitions_organiser_id_fkey(name)')
    .order('starts_on', { ascending: false })

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-neutral-200 p-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Competitions</h1>
        <p className="mt-0.5 text-sm text-neutral-500">Seasons, tournaments and gala days</p>
        <Link href="/competitions/new"
              className="mt-3 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold text-white"
              style={{ background: '#202842' }}>
          New competition
        </Link>
      </header>

      {(comps ?? []).length === 0 && (
        <p className="m-5 rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
          Nothing yet. A competition you enter, or one you run, appears here.
        </p>
      )}

      {(comps ?? []).map((c) => (
        <Link
          key={c.id}
          href={`/competitions/${c.id}`}
          className="flex items-center gap-3 border-b border-neutral-100 px-5 py-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="block truncate text-sm capitalize text-neutral-500">
              {[c.type.replace('_', ' '), orgName(c.academies), c.season].filter(Boolean).join(' · ')}
            </span>
          </span>
          {c.status === 'ended' && <span className="text-xs text-neutral-400">ended</span>}
        </Link>
      ))}
    </main>
  )
}

function orgName(rel: unknown): string | null {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { name?: string } | null)?.name ?? null
}
