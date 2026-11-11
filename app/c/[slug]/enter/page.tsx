import { createClient } from '@supabase/supabase-js'
import { EnterForm, type EntryInfo } from './enter-form'

/**
 * L-16: enter a team, in public. Cookie-less like the match centre; the
 * form posts to /api/competitions/enter. Nothing here is shown unless the
 * organiser has opened entries.
 */
export const revalidate = 60

export default async function EnterPage(ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const [{ data }, { data: switches }] = await Promise.all([
    anon.rpc('public_competition_entry', { p_slug: slug }),
    anon.rpc('public_switches', { p_slug: slug }),
  ])
  const info = (data as unknown as EntryInfo | null) ?? null
  const teamCreator = Boolean((switches as unknown as { team_creator?: boolean } | null)?.team_creator)
  if (!info) {
    return (
      <main className="grid min-h-dvh place-items-center px-6" style={{ background: 'var(--paper)' }}>
        <div className="max-w-sm text-center">
          <p className="display text-[1.625rem] leading-tight">Not taking entries</p>
          <p className="mt-2 text-sm text-ink-2">This competition isn&apos;t open to entries right now. Ask the organiser.</p>
        </div>
      </main>
    )
  }
  return <EnterForm slug={slug} info={info} teamCreator={teamCreator} />
}
