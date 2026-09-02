import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { InviteClubs, type ExistingInvite } from './invite-clubs'
import { siteUrl } from '@/lib/site'

export default async function InviteClubsPage(props: {
  params: Promise<{ competitionId: string }>
}) {
  const { competitionId } = await props.params
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: comp } = await supabase
    .from('competitions')
    .select('id, name, organiser_id')
    .eq('id', competitionId)
    .maybeSingle()
  if (!comp) notFound()

  const [{ data: contacts }, { data: entries }] = await Promise.all([
    supabase.rpc('competition_contacts', { p_competition: competitionId }),
    supabase
      .from('competition_entries')
      .select('division')
      .eq('competition_id', competitionId)
      .limit(1),
  ])

  const h = await headers()
  // The canonical site, never the request host. A join link goes into a
  // WhatsApp group and has to keep working after the next deploy.
  const origin = siteUrl()

  // The tokens themselves are only readable by the organiser, so they are
  // fetched separately rather than through the contacts function.
  const { data: invites } = await supabase
    .from('competition_invites')
    .select('id, club_name, token, status')
    .eq('competition_id', competitionId)
    .order('club_name')

  return (
    <main className="mx-auto max-w-md p-5">
      <Link href={`/competitions/${competitionId}`} className="text-sm text-neutral-500">← {comp.name}</Link>
      <h1 className="mt-2 text-2xl font-semibold" style={{ color: '#202842' }}>Invite clubs</h1>

      <InviteClubs
        competitionId={competitionId}
        origin={origin}
        defaultDivision={entries?.[0]?.division ?? ''}
        existing={(invites ?? []).map((i) => ({
          id: i.id,
          clubName: i.club_name,
          token: i.token,
          status: i.status,
        })) as ExistingInvite[]}
        contactCount={contacts?.length ?? 0}
      />
    </main>
  )
}
