import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The platform owner's page. Nobody else's.
 *
 * There is no role check in this component: platform_overview returns nothing
 * unless you are in platform_admins. An empty page for everybody else is the
 * database enforcing it, not this file remembering to.
 */
export default async function PlatformPage() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) redirect('/signin')

  const [{ data: rows }, { data: totals }] = await Promise.all([
    supabase.rpc('platform_overview'),
    supabase.rpc('platform_totals'),
  ])

  const t = totals?.[0]

  if (!rows || rows.length === 0) {
    return (
      <main className="mx-auto max-w-md p-5">
        <p className="rounded-xl bg-neutral-100 p-5 text-center text-sm text-neutral-500">
          Nothing here for you.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl p-5">
      <h1 className="text-2xl font-semibold" style={{ color: '#202842' }}>Platform</h1>

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

      <h2 className="mt-7 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Organisations
      </h2>
      <div className="mt-2 overflow-x-auto rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-xs text-neutral-500">
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
                <tr key={r.academy_id} className="border-b border-neutral-50">
                  <td className="p-2">
                    <span className="block font-medium">{r.name}</span>
                    <span className="block text-xs text-neutral-400">/{r.slug}</span>
                  </td>
                  <td className="p-2 text-center text-xs capitalize text-neutral-500">{r.type}</td>
                  <td className="p-2 text-center tabular-nums">{r.members}</td>
                  <td className="p-2 text-center tabular-nums">{r.teams}</td>
                  <td className="p-2 text-center tabular-nums">{r.messages}</td>
                  <td className="p-2 text-right text-xs tabular-nums"
                      style={{ color: quiet ? '#9CA3AF' : '#1C7A4C' }}>
                    {ago(r.last_activity)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-neutral-500">
        {/* Say what this page cannot do, so nobody assumes otherwise. */}
        Counts only. This page cannot read anyone&apos;s messages, children or contact details —
        being the platform owner is not the same as being a member.
      </p>
    </main>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="text-xl font-bold tabular-nums" style={{ color: highlight ? '#1C7A4C' : '#202842' }}>
        {value}
      </div>
      <div className="text-xs text-neutral-500">{label}</div>
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
