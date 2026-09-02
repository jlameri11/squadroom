'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Person = {
  id: string
  name: string
  role: string
  phone: string | null
  teams: string[]
}

const STAFF = ['owner', 'admin', 'coach']

export function DirectoryList({
  academyId, myId, iAmStaff, dmPolicy, people,
}: {
  academyId: string
  myId: string
  iAmStaff: boolean
  dmPolicy: string
  people: Person[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [team, setTeam] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const teams = useMemo(
    () => Array.from(new Set(people.flatMap((p) => p.teams))).sort(),
    [people]
  )

  const shown = people.filter((p) => {
    if (team && !p.teams.includes(team)) return false
    if (!query.trim()) return true
    return p.name.toLowerCase().includes(query.trim().toLowerCase())
  })

  const staff = shown.filter((p) => STAFF.includes(p.role))
  const others = shown.filter((p) => !STAFF.includes(p.role))

  /** Whether the academy's setting permits a private conversation with them. */
  function canMessage(p: Person) {
    if (p.id === myId) return false
    if (dmPolicy === 'open') return true
    return iAmStaff || STAFF.includes(p.role)
  }

  async function message(p: Person) {
    setBusy(p.id)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('open_direct_channel', {
      p_academy: academyId,
      p_other: p.id,
    })
    setBusy(null)
    if (error || !data) return setError(error?.message ?? 'Could not open that conversation.')
    router.push(`/chat/${data}`)
  }

  return (
    <div>
      <div className="p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people"
          className="w-full rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm"
        />

        {teams.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <Chip on={team === null} onClick={() => setTeam(null)}>All teams</Chip>
            {teams.map((t) => (
              <Chip key={t} on={team === t} onClick={() => setTeam(t)}>{t}</Chip>
            ))}
          </div>
        )}
      </div>

      {error && <p className="px-4 pb-2 text-sm ">{error}</p>}

      <Section title="Staff" people={staff} />
      <Section title="Families" people={others} />

      {!iAmStaff && dmPolicy === 'staff_only' && (
        <p className="p-4 text-center text-xs text-ink-2">
          Phone numbers of other families are hidden, and private messages go to coaches only.
          Your academy chose that.
        </p>
      )}
    </div>
  )

  function Section({ title, people: list }: { title: string; people: Person[] }) {
    if (list.length === 0) return null
    return (
      <section>
        <h2 className="border-b border-[var(--line-2)] bg-[var(--surface-3)] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
          {title} · {list.length}
        </h2>
        {list.map((p) => (
          <div key={p.id} className="flex items-center gap-3 border-b border-[var(--line-2)] px-4 py-3">
            <span
              className="grid h-10 w-10 flex-none place-items-center rounded-full text-xs font-bold text-white"
              style={{ background: STAFF.includes(p.role) ? 'var(--brand)' : 'var(--ink-3)' }}
            >
              {initials(p.name)}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium">{p.name}</span>
                {p.id === myId && <span className="text-xs text-ink-3">you</span>}
              </span>
              <span className="block truncate text-sm text-ink-2">
                <span className="capitalize">{p.role}</span>
                {p.teams.length > 0 && ` · ${p.teams.join(', ')}`}
              </span>
            </span>

            <span className="flex flex-none items-center gap-1">
              {/* Tap-to-call and wa.me only appear when a number came back.
                  The directory setting decides that server-side, so an absent
                  number here means the academy withheld it, not that we
                  forgot to render a button. */}
              {p.phone && (
                <>
                  <a href={`tel:${p.phone}`} className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)]" aria-label={`Call ${p.name}`}>📞</a>
                  <a
                    href={`https://wa.me/${p.phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)]"
                    aria-label={`WhatsApp ${p.name}`}
                  >
                    💬
                  </a>
                </>
              )}
              {canMessage(p) && (
                <button
                  onClick={() => message(p)}
                  disabled={busy === p.id}
                  className="grid h-9 w-9 place-items-center rounded-lg text-white disabled:opacity-50"
                  style={{ background: 'var(--brand)' }}
                  aria-label={`Message ${p.name}`}
                >
                  {busy === p.id ? '·' : '→'}
                </button>
              )}
            </span>
          </div>
        ))}
      </section>
    )
  }
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex-none rounded-full border px-3 py-1 text-xs font-medium"
      style={on
        ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' }
        : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
    >
      {children}
    </button>
  )
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '··'
}
