'use client'

import Link from 'next/link'

export type TeamSummary = {
  id: string
  name: string
  ageGroup: string
  season: string
  status: string
  memberCount: number
  playerCount: number
}

/**
 * U8 before U10, which sorting by text does not do.
 *
 * `order('age_group')` put U10 and U12 ahead of U8, so a club's youngest
 * squad sat at the bottom and a newly created U13 landed in the middle of
 * nowhere — which reads as the team not having been created at all.
 */
function ageOf(group: string): number {
  const n = Number(group.replace(/\D/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 999
}

export function TeamList({ teams }: { teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return (
      <p className="card p-6 text-center text-sm text-ink-2">
        No teams yet. Create one with the + above — its channel appears automatically.
      </p>
    )
  }

  const sorted = [...teams].sort(
    (a, b) => ageOf(a.ageGroup) - ageOf(b.ageGroup) || a.name.localeCompare(b.name)
  )
  const active = sorted.filter((t) => t.status === 'active')
  const ended = sorted.filter((t) => t.status !== 'active')

  return (
    <>
      <Group rows={active} />
      {ended.length > 0 && (
        <>
          <h2 className="eyebrow px-1 pb-2 pt-5">Past seasons</h2>
          <Group rows={ended} />
        </>
      )}
    </>
  )
}

function Group({ rows }: { rows: TeamSummary[] }) {
  if (rows.length === 0) return null
  return (
    <div className="card overflow-hidden">
      {rows.map((t) => (
        <Link key={t.id} href={`/admin/teams/${t.id}`} className="row">
          <span
            className="display grid h-10 w-10 flex-none place-items-center rounded-[11px] text-[15px] text-white"
            style={{ background: t.status === 'active' ? 'var(--brand)' : 'var(--ink-3)' }}
          >
            {t.ageGroup}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{t.name}</span>
            <span className="block truncate text-sm text-ink-2">
              {/*
                A squad with nobody in it is the normal state for a team made
                five seconds ago, so it says what to do rather than reading
                like something went wrong.
              */}
              {t.playerCount === 0 && t.memberCount === 0
                ? 'Empty — add players'
                : `${t.playerCount} ${t.playerCount === 1 ? 'player' : 'players'} · ${t.memberCount} ${t.memberCount === 1 ? 'member' : 'members'}`}
            </span>
          </span>

          <span className="flex flex-none items-center gap-2">
            <span className="tag">{t.season}</span>
            <span className="text-lg text-ink-3">›</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
