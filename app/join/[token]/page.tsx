import { createAdminClient } from '@/lib/supabase/admin'
import { JoinForm } from './join-form'

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
 * /join/<token> — the screen a parent lands on from the WhatsApp group.
 *
 * Server component: the link details are read with the service role, because
 * an unauthenticated visitor has no RLS identity to read them with. Only the
 * academy and team names are passed to the browser — nothing about the other
 * families, because anyone with the link can reach this page.
 *
 * params is a Promise in Next 16.
 */
export default async function JoinPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params
  const admin = createAdminClient()

  const { data: link } = await admin
    .from('join_links')
    .select('id, role, max_uses, use_count, expires_at, revoked_at, academies(name), teams(name)')
    .eq('token', token)
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
        <p className="text-sm text-neutral-500">
          Ask your coach to send you a new one — they can create it in a couple of taps.
        </p>
      </main>
    )
  }

  const academy = firstOf(link.academies)?.name ?? 'this academy'
  const team = firstOf(link.teams)?.name ?? null

  return <JoinForm token={token} academyName={academy} teamName={team} />
}
