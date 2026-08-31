import { createClient as createAnonClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/database.types'
import { ClaimInvite } from './claim-invite'

/**
 * A club's way into a competition.
 *
 * The preview runs on the anon key, because the person reading it may have no
 * account at all — which is the normal case when an organiser has invited a
 * hundred clubs who have never heard of us. It shows them enough to recognise
 * themselves and nothing about the other clubs.
 */
export default async function JoinCompetition(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params

  const anon = createAnonClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data: peek } = await anon.rpc('peek_competition_invite', { p_token: token })
  const invite = peek?.[0]

  if (!invite || invite.status !== 'pending') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
        <h1 className="text-2xl font-semibold">This invitation isn&apos;t active</h1>
        <p className="text-sm text-neutral-500">
          {invite?.status === 'claimed'
            ? 'It has already been used. If that wasn’t you, ask the organiser to send a new one.'
            : 'Ask the organiser for a new link.'}
        </p>
      </main>
    )
  }

  // Signed in? Then we can offer the organisations they already run.
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()

  let orgs: { id: string; name: string }[] = []
  if (auth.user) {
    const { data } = await supabase.from('academies').select('id, name').order('name')
    orgs = data ?? []
  }

  return (
    <ClaimInvite
      token={token}
      signedIn={Boolean(auth.user)}
      organisations={orgs}
      competitionName={invite.competition_name ?? 'a competition'}
      organiserName={invite.organiser_name ?? 'the organiser'}
      clubName={invite.club_name ?? 'your club'}
      division={invite.division}
      startsOn={invite.starts_on}
    />
  )
}
