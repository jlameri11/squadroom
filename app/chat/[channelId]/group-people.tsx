'use client'

import { Sheet } from '@/components/sheet'
import type { GroupInfo } from './channel-view'

/**
 * Who is in a computed room (0235): the league's people, then the clubs'
 * heads (or the referees), each with their club. Names and standing only —
 * no numbers, no way to add or remove anyone: membership follows the
 * competition.
 */
export function GroupPeople({ group, onClose }: { group: GroupInfo; onClose: () => void }) {
  const league = group.people.filter((p) => p.standing === 'league')
  const others = group.people.filter((p) => p.standing !== 'league')
  const othersTitle = group.kind === 'clubs' ? 'The clubs\u2019 heads' : group.kind === 'referees' ? 'Referees' : group.kind === 'committee' ? 'The committee' : 'Team managers'
  return (
    <Sheet onClose={onClose}>
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
      <h2 className="text-lg font-semibold">Who is in this chat</h2>
      <p className="mt-0.5 text-sm text-ink-2" data-group-people={group.people.length}>
        {group.kind === 'clubs'
          ? `${group.league ?? 'The league'} and the head of every club in ${group.competition ?? 'the competition'}. Who is in it follows the entries.`
          : group.kind === 'referees' ? `${group.league ?? 'The league'} and every referee in its pool.`
          : group.kind === 'committee' ? `${group.league ?? 'The club'}\u2019s committee, with its owners and admins. Who is in it follows the roles.`
          : `Every team manager at ${group.league ?? 'the club'}, with the owners, admins, President and Secretary. Who is in it follows the roles.`}
      </p>
      <section className="mt-4">
        <span className="eyebrow">{group.league ?? 'The league'}</span>
        <ul className="mt-1 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {league.length === 0 && <li className="py-2 text-xs text-ink-3">Nobody yet.</li>}
          {league.map((p) => (
            <li key={p.profile_id} className="py-2">{p.name}</li>
          ))}
        </ul>
      </section>
      <section className="mt-4">
        <span className="eyebrow">{othersTitle}</span>
        <ul className="mt-1 divide-y text-sm" style={{ borderColor: 'var(--line-2)' }}>
          {others.length === 0 && <li className="py-2 text-xs text-ink-3">Nobody yet.</li>}
          {others.map((p) => (
            <li key={p.profile_id} className="flex items-center justify-between gap-2 py-2">
              <span className="truncate">{p.name}</span>
              {p.club && <span className="flex-none truncate text-xs text-ink-3">{p.club}</span>}
            </li>
          ))}
        </ul>
      </section>
    </Sheet>
  )
}
