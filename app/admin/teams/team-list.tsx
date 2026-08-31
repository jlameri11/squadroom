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

export function TeamList({ teams }: { teams: TeamSummary[] }) {
  if (teams.length === 0) {
    return (
      <p className="rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
        No teams yet. Create one and its channel appears automatically.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {teams.map((t) => (
        <Link
          key={t.id}
          href={`/admin/teams/${t.id}`}
          className="flex items-center gap-3 rounded-xl border border-neutral-200 p-4"
        >
          <span
            className="grid h-10 w-10 flex-none place-items-center rounded-lg text-sm font-bold text-white"
            style={{ background: t.status === 'active' ? '#202842' : '#9CA3AF' }}
          >
            {t.ageGroup}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.name}</span>
            <span className="block text-sm text-neutral-500">
              {t.playerCount} players · {t.memberCount} members · {t.season}
              {t.status === 'ended' && ' · ended'}
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}
