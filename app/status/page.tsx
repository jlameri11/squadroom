import { createClient } from '@supabase/supabase-js'

export const revalidate = 60

type Item = { id: string; kind: 'notice' | 'incident' | 'resolved'; title: string; body: string | null; at: string; resolved_at: string | null }

/**
 * The status page (G-03): is anything known to be wrong? Anyone can open
 * it, with no account and nothing stored about them; it says only what the
 * platform admins wrote.
 */
export default async function StatusPage() {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
  const { data } = await anon.rpc('public_status')
  const status = (data as unknown as { ok: boolean; items: Item[] } | null) ?? { ok: true, items: [] }
  const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <main className="mx-auto max-w-md p-5" data-status>
      <p className="eyebrow">Squadroom</p>
      <h1 className="display text-3xl leading-tight">Status</h1>
      <p className="mt-3 rounded-xl p-3 text-sm font-semibold" style={status.ok ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : { background: 'var(--no-bg)', color: 'var(--no)' }} data-status-ok={status.ok}>
        {status.ok ? 'All good. Nothing known to be wrong.' : 'Something is wrong and we are on it.'}
      </p>
      {status.items.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {status.items.map((i) => (
            <li key={i.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
              <p className="text-[11px] uppercase tracking-wide text-ink-3">{i.kind === 'incident' && !i.resolved_at ? 'Ongoing' : i.kind === 'resolved' || i.resolved_at ? 'Resolved' : 'Notice'} · {when(i.at)}</p>
              <p className="font-semibold">{i.title}</p>
              {i.body && <p className="mt-1 text-sm text-ink-2">{i.body}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-ink-3">Signed in? Settings → Help and support reaches a person.</p>
    </main>
  )
}
