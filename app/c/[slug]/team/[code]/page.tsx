import { createClient } from '@supabase/supabase-js'
import { JoinTeamForm, type CaptainTeam } from './join-team-form'

export const revalidate = 0

/**
 * /c/{slug}/team/{code} — a captain's team's door (Team Creator, 0261). The
 * code a captain shares in the group chat; a teammate lands here, gives a
 * name, a mobile, an email and a date of birth, and is on the team. Only
 * the team's name, how full it is and the share are shown: nothing about
 * who is already on it.
 */
export default async function JoinTeamPage(ctx: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await ctx.params
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const { data } = await anon.rpc('public_captain_team', { p_slug: slug, p_code: code.toUpperCase() })
  const team = (data as unknown as CaptainTeam | null) ?? null
  if (!team) {
    return (
      <main className="grid min-h-dvh place-items-center px-6" style={{ background: 'var(--paper)' }}>
        <div className="max-w-sm text-center">
          <p className="display text-[1.625rem] leading-tight">No team has that code</p>
          <p className="mt-2 text-sm text-ink-2">Check the code with your captain — six letters and numbers, no zeros or ones.</p>
        </div>
      </main>
    )
  }
  return <JoinTeamForm slug={slug} code={code.toUpperCase()} team={team} />
}
