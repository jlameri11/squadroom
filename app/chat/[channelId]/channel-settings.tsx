'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const MODES = [
  {
    value: 'open' as const,
    label: 'Everyone can post',
    hint: 'A normal group chat.',
  },
  {
    value: 'hosts_only' as const,
    label: 'Only coaches can post',
    hint: 'Parents read and react, but cannot reply. For announcements, or a channel that had become unmanageable.',
  },
  {
    value: 'replies_only' as const,
    label: 'Replies only',
    hint: 'Parents can answer a coach’s message, but cannot start a new thread. Keeps a channel on topic without silencing it.',
  },
]

/**
 * The controls behind a channel.
 *
 * Every one of these is already enforced in the database - a parent in a
 * hosts_only channel is refused by a policy, not by a hidden button. This
 * screen is how a coach reaches the switch, and the words are chosen to say
 * what each one does to the people in the room.
 */
export function ChannelSettings({
  channelId, name, postingMode, restrictions, muted, isHost, onClose,
}: {
  channelId: string
  name: string
  postingMode: string
  restrictions: Record<string, boolean>
  muted: boolean
  isHost: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [mode, setMode] = useState(postingMode)
  const [rules, setRules] = useState(restrictions ?? {})
  const [isMuted, setIsMuted] = useState(muted)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function setMode_(next: string) {
    setMode(next)
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('channels')
      .update({ posting_mode: next as 'open' | 'hosts_only' | 'replies_only' })
      .eq('id', channelId)
    setBusy(false)
    if (error) { setMode(postingMode); return setError(error.message) }
    router.refresh()
  }

  async function toggleRule(key: string) {
    const next = { ...rules, [key]: !rules[key] }
    setRules(next)
    setBusy(true)
    const { error } = await supabase.from('channels').update({ restrictions: next }).eq('id', channelId)
    setBusy(false)
    if (error) { setRules(rules); setError(error.message) }
    router.refresh()
  }

  async function toggleMute() {
    const next = !isMuted
    setIsMuted(next)
    const { data: auth } = await supabase.auth.getUser()
    await supabase
      .from('channel_members')
      .update({ muted: next })
      .eq('channel_id', channelId)
      .eq('profile_id', auth.user!.id)
    router.refresh()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line)]" />
        <h2 className="text-lg font-semibold">{name}</h2>

        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
            Notifications
          </h3>
          <button
            onClick={toggleMute}
            className="mt-2 flex w-full items-center justify-between rounded-xl border border-[var(--line)] p-3 text-left"
          >
            <span>
              <span className="block font-medium">Mute this channel</span>
              <span className="block text-sm text-ink-2">
                {/* Muting is not hiding, and people assume it is. */}
                Stops the buzzing. You&apos;ll still see the unread count, and announcements still
                come through.
              </span>
            </span>
            <span
              className="ml-3 h-6 w-11 flex-none rounded-full p-0.5 transition"
              style={{ background: isMuted ? 'var(--brand)' : 'var(--line)' }}
            >
              <span
                className="block h-5 w-5 rounded-full bg-[var(--surface)] transition"
                style={{ transform: isMuted ? 'translateX(20px)' : 'none' }}
              />
            </span>
          </button>
        </section>

        {isHost && (
          <>
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                Who can post
              </h3>
              <div className="mt-2 flex flex-col gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode_(m.value)}
                    disabled={busy}
                    className="rounded-xl border p-3 text-left disabled:opacity-60"
                    style={{
                      borderColor: mode === m.value ? 'var(--brand)' : 'var(--line)',
                      background: mode === m.value ? 'var(--brand-faint)' : undefined,
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="grid h-4 w-4 flex-none place-items-center rounded-full border"
                            style={{ borderColor: mode === m.value ? 'var(--brand)' : 'var(--ink-3)' }}>
                        {mode === m.value && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--brand)' }} />}
                      </span>
                      <span className="font-medium">{m.label}</span>
                    </span>
                    <span className="mt-1 block pl-6 text-sm text-ink-2">{m.hint}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
                Extra rules
              </h3>
              <div className="mt-2 flex flex-col gap-2">
                <Rule
                  on={Boolean(rules.approval_required)}
                  onClick={() => toggleRule('approval_required')}
                  label="Approve posts before they appear"
                  hint="Everything a parent writes waits for you. Nobody else sees it until you say so."
                />
                <Rule
                  on={Boolean(rules.no_images)}
                  onClick={() => toggleRule('no_images')}
                  label="No photos"
                  hint="Text only."
                />
              </div>
            </section>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button onClick={onClose} className="mt-5 w-full py-2 text-sm text-ink-2">
          Done
        </button>
      </div>
    </div>
  )
}

function Rule({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button onClick={onClick} className="flex items-start justify-between rounded-xl border border-[var(--line)] p-3 text-left">
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-ink-2">{hint}</span>
      </span>
      <span className="ml-3 h-6 w-11 flex-none rounded-full p-0.5 transition"
            style={{ background: on ? 'var(--brand)' : 'var(--line)' }}>
        <span className="block h-5 w-5 rounded-full bg-[var(--surface)] transition"
              style={{ transform: on ? 'translateX(20px)' : 'none' }} />
      </span>
    </button>
  )
}
