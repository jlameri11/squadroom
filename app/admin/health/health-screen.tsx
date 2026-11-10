'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCurrentOrg } from '@/lib/use-current-org'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type TeamRow = { id: string; name: string; players: number; with_family: number; pct: number }
type Health = {
  academy_id: string
  families: { players: number; with_family: number; pct: number; teams: TeamRow[] }
  teams_without_manager: { id: string; name: string }[]
  checks: { missing: number; barred: number; expired: number; expiring: number; people: number }
  playfootball_not_done: number
  setup: { done: number; total: number; complete: boolean } | null
}

/**
 * Club health (Big Club Mode items 5 and 12; 0247). One card for the
 * committee, read from the data: how many families have joined, per squad;
 * squads with nobody in front of them; Working With Children Checks running
 * out; PlayFootball not done; and how far setup has got. Each line opens the
 * screen that fixes it. For owners, admins, the President and the
 * Secretary; the database decides (club_health).
 */
export function HealthScreen() {
  const org = useCurrentOrg()
  const [health, setHealth] = useState<Health | null | undefined>(undefined)

  useEffect(() => {
    if (!org) return
    let live = true
    ;(async () => {
      const { data } = await createClient().rpc('club_health', { p_academy: org.id })
      if (live) setHealth((data as unknown as Health | null) ?? null)
    })()
    return () => {
      live = false
    }
  }, [org])

  if (!org || health === undefined) return <ScreenSkeleton />
  if (health === null) {
    return (
      <p className="m-5 card p-5 text-center text-sm text-ink-2">
        Club health is for the club&apos;s owners and admins, the President and the Secretary.
      </p>
    )
  }

  const f = health.families
  const c = health.checks
  const worst = f.teams.filter((t) => t.players > 0).slice(0, 8)
  const checkProblems = c.missing + c.barred + c.expired + c.expiring

  return (
    <div className="p-4 pb-10" data-club-health>
      {/* The numbers first, in the order a committee worries about them. */}
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Families in the app" value={`${f.pct}%`} hint={`${f.with_family} of ${f.players} players`} tone={f.pct >= 80 ? 'good' : f.pct >= 50 ? 'warn' : 'bad'} />
        <Stat label="Nobody in front of" value={String(health.teams_without_manager.length)} hint={health.teams_without_manager.length === 1 ? 'squad' : 'squads'} tone={health.teams_without_manager.length === 0 ? 'good' : 'bad'} />
        <Stat label="Checks to chase" value={String(checkProblems)} hint={`of ${c.people} staff and coaches`} tone={checkProblems === 0 ? 'good' : c.barred + c.expired + c.missing > 0 ? 'bad' : 'warn'} />
        <Stat label="PlayFootball not done" value={String(health.playfootball_not_done)} hint={health.playfootball_not_done === 1 ? 'player' : 'players'} tone={health.playfootball_not_done === 0 ? 'good' : 'warn'} />
      </div>

      <section className="card mt-4 p-3.5" data-health-families>
        <div className="sect">
          <span className="eyebrow">Families joined, per squad</span>
          <Link href="/admin/teams" className="tap text-xs text-ink-2 underline underline-offset-4">Codes and QR</Link>
        </div>
        {worst.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">No players on any squad yet — import the roster, then share each squad&apos;s code.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {worst.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/teams/${t.id}`} className="block">
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{t.name}</span>
                    <span className="flex-none text-xs tabular-nums text-ink-2">{t.with_family} of {t.players} · {t.pct}%</span>
                  </span>
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }} aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${t.pct}%`, background: t.pct >= 80 ? 'var(--yes)' : 'var(--accent)' }} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-3 p-3.5" data-health-managers>
        <div className="sect">
          <span className="eyebrow">Squads with nobody in front of them</span>
          <Link href="/admin/roles" className="tap text-xs text-ink-2 underline underline-offset-4">Roles</Link>
        </div>
        {health.teams_without_manager.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--yes)' }}>Every squad has a coach or a team manager.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-[var(--line-2)]">
            {health.teams_without_manager.map((t) => (
              <li key={t.id}>
                <Link href={`/admin/teams/${t.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 truncate">{t.name}</span>
                  <span className="flex-none text-xs" style={{ color: 'var(--accent)' }}>no coach or manager</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-3 p-3.5" data-health-checks>
        <div className="sect">
          <span className="eyebrow">Working With Children Checks</span>
          <Link href="/admin/clearances" className="tap text-xs text-ink-2 underline underline-offset-4">The board</Link>
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <Count n={c.missing} word="missing" bad />
          <Count n={c.expired} word="expired" bad />
          <Count n={c.expiring} word="expiring within 60 days" />
          <Count n={c.barred} word="barred" bad />
        </ul>
        {checkProblems === 0 && <p className="mt-1 text-sm" style={{ color: 'var(--yes)' }}>Everyone is cleared and current.</p>}
      </section>

      <section className="card mt-3 p-3.5" data-health-playfootball>
        <div className="sect">
          <span className="eyebrow">PlayFootball</span>
          <Link href="/admin/import/playfootball" className="tap text-xs text-ink-2 underline underline-offset-4">Tick off an export</Link>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {health.playfootball_not_done === 0
            ? 'Nobody is waiting on official registration.'
            : `${health.playfootball_not_done} ${health.playfootball_not_done === 1 ? 'player is' : 'players are'} not yet registered in PlayFootball. Squadroom never does that for you — remind the families, then import the club's export.`}
        </p>
      </section>

      {health.setup && !health.setup.complete && (
        <Link href="/start/setup" className="card mt-3 block p-3.5" data-health-setup>
          <span className="sect">
            <span className="eyebrow">Setting up</span>
            <span className="text-xs text-ink-2">{health.setup.done} of {health.setup.total} steps</span>
          </span>
          <span className="mt-1 block text-sm text-ink-2">The checklist, with one tap to each step.</span>
        </Link>
      )}
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'good' | 'warn' | 'bad' }) {
  const colour = tone === 'good' ? 'var(--yes)' : tone === 'warn' ? 'var(--accent)' : 'var(--no)'
  return (
    <div className="card p-3">
      <span className="block text-xs text-ink-3">{label}</span>
      <span className="display mt-0.5 block text-[1.5rem] leading-none tabular-nums" style={{ color: colour }}>{value}</span>
      <span className="mt-1 block truncate text-xs text-ink-2">{hint}</span>
    </div>
  )
}

function Count({ n, word, bad }: { n: number; word: string; bad?: boolean }) {
  if (n === 0) return null
  return (
    <li className="tabular-nums" style={{ color: bad ? 'var(--no)' : 'var(--accent)' }}>
      <b>{n}</b> {word}
    </li>
  )
}
