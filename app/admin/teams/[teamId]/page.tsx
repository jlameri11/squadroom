import { headers } from 'next/headers'
import { AttendancePanel } from './attendance-panel'
import { redirect, notFound } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient, getUserId } from '@/lib/supabase/server'
import { JoinLinkPanel } from './join-link-panel'
import { AddPlayers } from './add-players'
import { AppShellPage } from '@/components/shell-page'
import { BulkInvite } from './bulk-invite'
import { SeasonControl } from './season-control'
import { siteUrl } from '@/lib/site'

/**
 * One team: how people get in, and who is already here.
 *
 * params and headers are both async in Next 16.
 */
export default async function TeamPage(props: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await props.params
  const supabase = await createClient()

  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const { data: team } = await supabase
    .from('teams')
    .select('id, academy_id, name, age_group, season, status')
    .eq('id', teamId)
    .maybeSingle()

  if (!team) notFound()

  const [{ data: link }, { data: members }, { data: players }] = await Promise.all([
    supabase
      .from('join_links')
      .select('id, token, code, role, max_uses, use_count, expires_at')
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
  // The canonical site, never the request host. A join link goes into a
  // WhatsApp group and has to keep working after the next deploy.
  const origin = siteUrl()
  const joinUrl = link ? `${origin}/join/${link.token}` : null

  // Rendered here rather than in the browser: it is a static image of a
  // string we already have, so there is no reason to ship a QR library to
  // every phone that opens this page.
  const qrSvg = joinUrl
    ? await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220, color: { dark: '#202842', light: '#ffffff' } })
    : null

  const playerNames = (players ?? []).map((p) => p.full_name)

  return (
    <AppShellPage
      title={team.name}
      meta={`${team.age_group} · ${team.season}${team.status === 'ended' ? ' · season ended' : ''}`}
      back="/admin/teams"
      action={<AddPlayers teamId={team.id} academyId={team.academy_id} existing={playerNames} />}
    >
      <div className="p-4">

      <JoinLinkPanel
        teamId={team.id}
        academyId={team.academy_id}
        link={link ? { id: link.id, url: joinUrl!, code: link.code, useCount: link.use_count, maxUses: link.max_uses, expiresAt: link.expires_at } : null}
        qrSvg={qrSvg}
      />

      <BulkInvite teamId={team.id} academyId={team.academy_id} />

      <AttendancePanel academyId={team.academy_id} teamId={team.id} />

      <section className="mt-7">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
          Players · {players?.length ?? 0}
        </h2>
        <div className="rounded-xl border border-[var(--line)]">
          {(players ?? []).map((p, i) => (
            <div key={p.id} className={`p-3 ${i > 0 ? 'border-t border-[var(--line-2)]' : ''}`}>
              <div className="font-medium">{p.full_name}</div>
              <div className="text-sm text-ink-2">{guardianNames(p.player_guardians) || 'No guardian linked'}</div>
            </div>
          ))}
          {(players ?? []).length === 0 && (
            <p className="p-4 text-center text-sm text-ink-2">
              No players yet. They are added as families join.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
          People · {members?.length ?? 0}
        </h2>
        <div className="rounded-xl border border-[var(--line)]">
          {(members ?? []).map((m, i) => (
            <div key={m.profile_id} className={`flex items-center gap-2 p-3 ${i > 0 ? 'border-t border-[var(--line-2)]' : ''}`}>
              <span className="flex-1 font-medium">{nameOf(m.profiles)}</span>
              <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs capitalize text-ink-2">{m.role}</span>
            </div>
          ))}
        </div>
      </section>

      <SeasonControl teamId={team.id} status={team.status} />
      </div>
    </AppShellPage>
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
