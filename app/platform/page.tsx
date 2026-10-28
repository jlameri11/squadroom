import { redirect } from 'next/navigation'
import { createClient, getUserId } from '@/lib/supabase/server'
import { AppShellPage } from '@/components/shell-page'

/**
 * The platform owner's page. Nobody else's.
 *
 * There is no role check in this component: platform_overview returns nothing
 * unless you are in platform_admins. An empty page for everybody else is the
 * database enforcing it, not this file remembering to.
 */
export default async function PlatformPage() {
  const supabase = await createClient()
  const userId = await getUserId()
  if (!userId) redirect('/signin')

  const [{ data: rows }, { data: totals }] = await Promise.all([
    supabase.rpc('platform_overview'),
    supabase.rpc('platform_totals'),
  ])

  const t = totals?.[0]

  if (!rows || rows.length === 0) {
    return (
      <AppShellPage title="Platform">
      <div className="p-4">
        <p className="rounded-xl bg-[var(--surface-2)] p-5 text-center text-sm text-ink-2">
          Nothing here for you.
        </p>
      </div>
    </AppShellPage>
    )
  }

  return (
    <main className="mx-auto max-w-2xl p-5">

      {t && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          <Stat label="Organisations" value={t.organisations} />
          <Stat label="People" value={t.people} />
          <Stat label="Teams" value={t.teams} />
          <Stat label="Players" value={t.players} />
          <Stat label="Messages" value={t.messages} />
          <Stat label="Competitions" value={t.competitions} />
          <Stat label="Active this week" value={t.active_7d} highlight />
        </div>
      )}

      <h2 className="mt-7 text-xs font-semibold uppercase tracking-wide text-ink-2">
        Organisations
      </h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--line-2)] text-xs text-ink-2">
              <th className="p-2 text-left font-medium">Name</th>
              <th className="p-2 font-medium">Type</th>
              <th className="p-2 font-medium">People</th>
              <th className="p-2 font-medium">Teams</th>
              <th className="p-2 font-medium">Msgs</th>
              <th className="p-2 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const quiet = daysSince(r.last_activity) > 14
              return (
                <tr key={r.academy_id} className="border-b border-[var(--line-2)]">
                  <td className="p-2">
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-ink-3">/{r.slug}</span>
                  </td>
                  <td className="p-2 text-center text-xs capitalize text-ink-2">{r.type}</td>
                  <td className="p-2 text-center tabular-nums">{r.members}</td>
                  <td className="p-2 text-center tabular-nums">{r.teams}</td>
                  <td className="p-2 text-center tabular-nums">{r.messages}</td>
                  <td className="p-2 text-right text-xs tabular-nums"
                      style={{ color: quiet ? 'var(--ink-3)' : 'var(--yes)' }}>
                    {ago(r.last_activity)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-2">
        {/* Say what this page cannot do, so nobody assumes otherwise. */}
        Counts only. This page cannot read anyone&apos;s messages, children or contact details —
        being the platform owner is not the same as being a member.
      </p>
    </main>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--line)] p-3">
      <div className="text-xl font-bold tabular-nums" style={{ color: highlight ? 'var(--yes)' : 'var(--brand-text)' }}>
        {value}
      </div>
      <div className="text-xs text-ink-2">{label}</div>
    </div>
  )
}

function daysSince(iso: string | null): number {
  if (!iso) return 9999
  return (Date.now() - new Date(iso).getTime()) / 86400000
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const d = daysSince(iso)
  if (d < 1) return 'today'
  if (d < 2) return 'yesterday'
  if (d < 14) return `${Math.round(d)}d`
  if (d < 60) return `${Math.round(d / 7)}w`
  return `${Math.round(d / 30)}mo`
}
