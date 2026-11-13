import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserId } from '@/lib/supabase/server'
import { joinLinkFilter } from '@/lib/join'
import { JoinForm } from './join-form'
import { JoinLanding } from './join-landing'

/**
 * PostgREST returns a single object for a to-one relationship, but the
 * generated types describe it as an array. Normalise rather than casting,
 * so this keeps working whichever shape comes back.
 */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * /join/<token> — the screen a parent lands on from the WhatsApp group, or
 * by typing the coach's six characters.
 *
 * Server component: the link details are read with the service role, because
 * a visitor may have no RLS identity to read them with. Only the club's name
 * and crest and the team's name reach the browser — nothing about the other
 * families, because anyone with the link can reach this page.
 *
 * The sign-up brief (12 Nov 2026): an account is always required. Nobody
 * signed in sees the crest and "Join U9 Navy at NRIFA" with Create account
 * or Sign in, both of which come straight back here; somebody signed in sees
 * the join request itself — their children's names and birthdays, as before.
 *
 * params is a Promise in Next 16.
 */
export default async function JoinPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const admin = createAdminClient()

  // The route segment may be a 24-character token from a QR or a six-character
  // code somebody typed. One resolver decides which, shared with the request
  // route so the two cannot disagree about a revoked link.
  const { column, value } = joinLinkFilter(token)

  const { data: link } = await admin
    .from('join_links')
    .select('id, role, academy_id, team_id, max_uses, use_count, expires_at, revoked_at, academies(name, logo_url, primary_colour), teams(name)')
    .eq(column, value)
    .maybeSingle()

  const dead =
    !link ||
    link.revoked_at !== null ||
    new Date(link.expires_at) < new Date() ||
    (link.max_uses !== null && link.use_count >= link.max_uses)

  if (dead) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">This link has expired</h1>
        <p className="text-sm text-ink-2">
          Ask your coach to send you a new one — they can create it in a couple of taps.
        </p>
      </main>
    )
  }

  const club = firstOf(link.academies)
  const academy = club?.name ?? 'this club'
  const team = firstOf(link.teams)?.name ?? null

  const userId = await getUserId()
  if (!userId) {
    return (
      <JoinLanding
        token={token}
        academyName={academy}
        teamName={team}
        logoUrl={(club as { logo_url?: string | null } | null)?.logo_url ?? null}
        colour={(club as { primary_colour?: string | null } | null)?.primary_colour ?? null}
      />
    )
  }

  // Signed in: who they are, whether they already asked here, and the club's
  // squads by name (0256) for someone who would like to coach, manage or
  // help one. Names only — nothing about who is in them.
  const [{ data: me }, { data: asked }, { data: squads }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    admin
      .from('join_requests')
      .select('id, status')
      .eq('join_link_id', link.id)
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('teams').select('id, name').eq('academy_id', link.academy_id).eq('status', 'active').order('name'),
  ])
  // Approved already: they are in. The link has done its job.
  if (asked?.status === 'approved') redirect('/')

  return (
    <JoinForm
      token={token}
      academyName={academy}
      teamName={team}
      teamId={link.team_id}
      squads={(squads ?? []).map((s) => ({ id: s.id, name: s.name }))}
      role={link.role}
      account={{ fullName: me?.full_name ?? '' }}
      pendingRequestId={asked?.status === 'pending' ? asked.id : null}
    />
  )
}
