import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { JoinLinkPanel } from './join-link-panel'
import { BulkInvite } from './bulk-invite'
import { SeasonControl } from './season-control'

/**
 * One team: how people get in, and who is already here.
 *
 * params and headers are both async in Next 16.
 */
export default async function TeamPage(props: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await props.params
  const supabase = await createClient()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const { data: team } = await supabase
    .from('teams')
    .select('id, academy_id, name, age_group, season, status')
    .eq('id', teamId)
    .maybeSingle()

  if (!team) notFound()

  const [{ data: link }, { data: members }, { data: players }] = await Promise.all([
    supabase
      .from('join_links')
      .select('id, token, role, max_uses, use_count, expires_at')
      .eq('team_id', teamId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('team_members')
      .select('profile_id, role, profiles(full_name)')
      .eq('team_id', teamId),
    supabase
      .from('players')
      .select('id, full_name, player_guardians(profiles(full_name))')
      .eq('team_id', teamId)
      .order('full_name'),
  ])

  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`
  const joinUrl = link ? `${origin}/join/${link.token}` : null

  // Rendered here rather than in the browser: it is a static image of a
  // string we already have, so there is no reason to ship a QR library to
  // every phone that opens this page.
  const qrSvg = joinUrl
    ? await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220, color: { dark: '#202842', light: '#ffffff' } })
    : null

  return (
    <main className="mx-auto max-w-md p-5">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>{team.name}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {team.age_group} · {team.season}
          {team.status === 'ended' && ' · season ended, channels read-only'}
        </p>
      </header>

      <JoinLinkPanel
        teamId={team.id}
        academyId={team.academy_id}
        link={link ? { id: link.id, url: joinUrl!, useCount: link.use_count, maxUses: link.max_uses, expiresAt: link.expires_at } : null}
        qrSvg={qrSvg}
      />

      <BulkInvite teamId={team.id} academyId={team.academy_id} />

      <section className="mt-7">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Players · {players?.length ?? 0}
        </h2>
        <div className="rounded-xl border border-neutral-200">
          {(players ?? []).map((p, i) => (
            <div key={p.id} className={`p-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
              <div className="font-medium">{p.full_name}</div>
              <div className="text-sm text-neutral-500">{guardianNames(p.player_guardians) || 'No guardian linked'}</div>
            </div>
          ))}
          {(players ?? []).length === 0 && (
            <p className="p-4 text-center text-sm text-neutral-500">
              No players yet. They are added as families join.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          People · {members?.length ?? 0}
        </h2>
        <div className="rounded-xl border border-neutral-200">
          {(members ?? []).map((m, i) => (
            <div key={m.profile_id} className={`flex items-center gap-2 p-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
              <span className="flex-1 font-medium">{nameOf(m.profiles)}</span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs capitalize text-neutral-600">{m.role}</span>
            </div>
          ))}
        </div>
      </section>

      <SeasonControl teamId={team.id} status={team.status} />
    </main>
  )
}

function nameOf(rel: unknown): string {
  const one = Array.isArray(rel) ? rel[0] : rel
  return (one as { full_name?: string } | null)?.full_name ?? 'Unnamed'
}

function guardianNames(rel: unknown): string {
  if (!Array.isArray(rel)) return ''
  return rel.map((g) => nameOf((g as { profiles: unknown }).profiles)).filter(Boolean).join(', ')
}
