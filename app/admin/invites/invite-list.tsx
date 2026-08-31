'use client'

export type InviteRow = {
  id: string
  name: string
  phone: string
  role: string
  status: string
  invitedBy: string | null
  createdAt: string
}

export type RequestRow = {
  id: string
  name: string
  phone: string | null
  status: string
  createdAt: string
}

const TONE: Record<string, string> = {
  accepted: 'bg-green-50 text-green-700',
  approved: 'bg-green-50 text-green-700',
  pending:  'bg-amber-50 text-amber-700',
  declined: 'bg-neutral-100 text-neutral-500',
  revoked:  'bg-neutral-100 text-neutral-500',
  expired:  'bg-neutral-100 text-neutral-500',
}

export function InviteList({ invites, requests }: { invites: InviteRow[]; requests: RequestRow[] }) {
  return (
    <div className="flex flex-col gap-7">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Came in through a link · {requests.length}
        </h2>
        <div className="rounded-xl border border-neutral-200">
          {requests.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="text-sm tabular-nums text-neutral-500">
                  {r.phone ?? 'no number'} · {ago(r.createdAt)}
                </div>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[r.status] ?? 'bg-neutral-100'}`}>
                {r.status}
              </span>
            </div>
          ))}
          {requests.length === 0 && (
            <p className="p-4 text-center text-sm text-neutral-500">
              Nobody has used a team link yet.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Invited by phone · {invites.length}
        </h2>
        <p className="mb-2 text-xs text-neutral-500">
          A row here means an invite is waiting, not that a text was sent — onboarding sends none.
        </p>
        <div className="rounded-xl border border-neutral-200">
          {invites.map((iv, i) => (
            <div key={iv.id} className={`flex items-center gap-3 p-3 ${i > 0 ? 'border-t border-neutral-100' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{iv.name}</div>
                <div className="truncate text-sm text-neutral-500">
                  {iv.role}
                  {iv.invitedBy && ` · by ${iv.invitedBy}`}
                  {' · '}
                  {ago(iv.createdAt)}
                </div>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[iv.status] ?? 'bg-neutral-100'}`}>
                {iv.status}
              </span>
            </div>
          ))}
          {invites.length === 0 && (
            <p className="p-4 text-center text-sm text-neutral-500">No phone invites.</p>
          )}
        </div>
      </section>
    </div>
  )
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
