'use client'

import { Sheet } from '@/components/sheet'
import { invalidateScreen } from '@/lib/hooks/use-screen'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Member = { profile_id: string; full_name: string; role: string }
type Team = { id: string; name: string }

/**
 * Starting a chat.
 *
 * Every channel until now appeared on its own — one per team, one per age
 * group, one for the academy. Everything else a club talks about (a carnival
 * squad, the committee, the four parents running the BBQ) had nowhere to go,
 * which sends exactly those conversations back to the WhatsApp group this is
 * meant to replace.
 *
 * Coaches and admins only. A product where any parent can start a channel and
 * add other people's families fragments in a fortnight, with nobody
 * accountable for what is in each room.
 */
export function NewChat({ academyId, canCreate }: { academyId: string; canCreate: boolean }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState('')
  const [mode, setMode] = useState<'open' | 'hosts_only'>('open')
  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase
      .from('teams')
      .select('id, name')
      .eq('academy_id', academyId)
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setTeams(data ?? []))
    supabase
      .rpc('member_directory', { p_academy: academyId })
      .then(({ data }) => setMembers((data ?? []) as Member[]))
  }, [open, academyId])

  async function create() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('create_channel', {
      p_academy: academyId,
      p_name: name.trim(),
      p_team: teamId || undefined,
      p_members: teamId ? [] : Array.from(chosen),
      p_mode: mode,
    })
    setBusy(false)
    if (error) return setError(error.message)
    // The chat list is cached; without this the new room would not appear.
    invalidateScreen('chat_screen')
    invalidateScreen('home_screen')
    window.location.href = `/chat/${data}`
  }

  if (!canCreate) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="grid h-9 w-9 flex-none place-items-center rounded-[10px] text-xl"
        style={{ background: '#ffffff26', color: 'var(--brand-ink)' }}
        aria-label="Start a chat"
      >
        ＋
      </button>
    )
  }

  const ready = name.trim().length > 0 && (teamId !== '' || chosen.size > 0)

  return (
    <Sheet onClose={() => setOpen(false)}>
        <h2 className="display text-xl">Start a chat</h2>

        <label className="mt-4 block text-sm">
          <span className="text-ink-2">What is it called?</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gala day squad"
            autoFocus
            className="mt-1 w-full rounded-xl border border-[var(--line)] p-2.5"
          />
        </label>

        <label className="mt-3 block text-sm">
          <span className="text-ink-2">Who is in it?</span>
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--line)] p-2.5"
          >
            <option value="">Pick people myself</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                Everyone in {t.name}
              </option>
            ))}
          </select>
        </label>

        {/* Picking a team adds whoever is in it now AND later, which is what a
            coach means by "the U10s". Picking people is a fixed list. */}
        {teamId === '' && (
          <div className="mt-3">
            <p className="text-sm text-ink-2">
              {chosen.size === 0 ? 'Choose who to add' : `${chosen.size} chosen`}
            </p>
            <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-[var(--line)]">
              {members.map((m) => (
                <li key={m.profile_id}>
                  <button
                    onClick={() => {
                      const next = new Set(chosen)
                      if (next.has(m.profile_id)) next.delete(m.profile_id)
                      else next.add(m.profile_id)
                      setChosen(next)
                    }}
                    className="flex w-full items-center justify-between gap-2 border-b border-[var(--line-2)] px-3 py-2.5 text-left text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {m.full_name}
                      <span className="ml-1.5 text-xs capitalize text-ink-3">{m.role}</span>
                    </span>
                    <span
                      className="grid h-5 w-5 flex-none place-items-center rounded-full border text-xs"
                      style={{
                        borderColor: chosen.has(m.profile_id) ? 'var(--brand)' : 'var(--line)',
                        background: chosen.has(m.profile_id) ? 'var(--brand)' : 'transparent',
                        color: '#fff',
                      }}
                    >
                      {chosen.has(m.profile_id) ? '✓' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="mt-3 flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={mode === 'hosts_only'}
            onChange={(e) => setMode(e.target.checked ? 'hosts_only' : 'open')}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-medium">Only I can post</span>
            <span className="block text-xs text-ink-3">
              Everyone reads and reacts, but cannot reply. For notices rather than conversation.
            </span>
          </span>
        </label>

        {error && <p className="mt-3 text-sm ">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={create} disabled={!ready || busy} className="btn flex-1 disabled:opacity-50">
            {busy ? 'Creating…' : 'Start the chat'}
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-quiet">
            Cancel
          </button>
        </div>
    </Sheet>
  )
}
