import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'

export default async function CompetitionsPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  // RLS returns competitions you organise or your club has entered.
  const { data: comps } = await supabase
    .from('competitions')
    .select('id, name, type, season, organiser, starts_on, ends_on, status, organiser_id, academies!competitions_organiser_id_fkey(name)')
    .order('starts_on', { ascending: false })

  return (
    <AppShellPage title="Competitions">
      <div className="p-4">

      {(comps ?? []).length === 0 && (
        <p className="m-5 rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Nothing yet. A competition you enter, or one you run, appears here.
        </p>
      )}

      {(comps ?? []).map((c) => (
        <Link
          key={c.id}
          href={`/competitions/${c.id}`}
          className="flex items-center gap-3 border-b border-[var(--line-2)] px-5 py-4"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{c.name}</span>
            <span className="block truncate text-sm capitalize text-ink-2">
              {[c.type.replace('_', ' '), orgName(c.academies), c.season].filter(Boolean).join(' · ')}
            </span>
          </span>
          {c.status === 'ended' && <span className="text-xs text-ink-3">ended</span>}
        </Link>
      ))}
    </div>
    </AppShellPage>
  )
}

function orgName(rel: unknown): string | null {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { name?: string } | null)?.name ?? null
}
