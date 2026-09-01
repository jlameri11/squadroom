'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type CardPoll = {
  id: string
  type: string
  question: string
  multi: boolean
  anonymous: boolean
  closes_at: string | null
  closed_at: string | null
  linked_event_id: string | null
  is_open: boolean
}

type Result = { option_id: string; label: string; votes: number; voted_by_me: boolean }
type MyVote = { player_id: string | null; player_name: string | null; option_ids: string[] | null; note: string | null }
type Missing = { profile_id: string; full_name: string; player_id: string | null; player_name: string | null }

const TINT: Record<string, string> = { yes: '#1C7A4C', maybe: '#9C6B06', no: '#8E3020' }

export function PollCard({ poll, isHost }: { poll: CardPoll; isHost: boolean }) {
  const [results, setResults] = useState<Result[]>([])
  const [mine, setMine] = useState<MyVote[]>([])
  const [missing, setMissing] = useState<Missing[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [showMissing, setShowMissing] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.rpc('poll_results', { p_poll: poll.id }),
      supabase.rpc('my_poll_votes', { p_poll: poll.id }),
    ])
    setResults((r ?? []) as Result[])
    setMine((m ?? []) as MyVote[])
    if (isHost) {
      const { data: n } = await supabase.rpc('poll_non_responders', { p_poll: poll.id })
      setMissing((n ?? []) as Missing[])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.id, isHost])

  useEffect(() => { load() }, [load])

  async function vote(optionId: string, playerId: string | null, note?: string | null) {
    setBusy(playerId ?? 'me')
    await supabase.rpc('cast_poll_vote', {
      p_poll: poll.id,
      p_options: [optionId],
      p_player: playerId ?? undefined,
      p_note: note ?? undefined,
    })
    await load()
    setBusy(null)
  }

  const total = results.reduce((n, r) => n + r.votes, 0)
  const closesSoon = poll.closes_at && poll.is_open

  return (
    <div className="w-full overflow-hidden rounded-xl border bg-white" style={{ borderColor: '#202842' }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: '#2028420d' }}>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
              style={{ background: '#202842' }}>
          {poll.type === 'availability' ? 'Availability' : 'Poll'}
        </span>
        {!poll.is_open && <span className="text-xs font-medium text-neutral-500">Closed</span>}
        {closesSoon && (
          <span className="ml-auto text-xs text-neutral-500">
            closes {new Date(poll.closes_at!).toLocaleDateString('en-AU', { weekday: 'short', hour: 'numeric' })}
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="font-semibold leading-snug">{poll.question}</p>

        {/* Availability: one row per child, because that is the question. */}
        {poll.type === 'availability' && poll.is_open && mine.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {mine.map((m) => (
              <div key={m.player_id} className="flex items-center gap-2">
                <span className="w-14 flex-none truncate text-sm font-medium text-neutral-600">
                  {m.player_name?.split(' ')[0]}
                </span>
                <div className="flex flex-1 gap-1">
                  {(['yes', 'maybe', 'no'] as const).map((opt) => {
                    const on = m.option_ids?.[0] === opt
                    return (
                      <button
                        key={opt}
                        onClick={() => vote(opt, m.player_id, m.note)}
                        disabled={busy === m.player_id}
                        className="flex-1 rounded-lg border py-1.5 text-xs font-semibold capitalize disabled:opacity-60"
                        style={on
                          ? { borderColor: TINT[opt], background: `${TINT[opt]}18`, color: TINT[opt] }
                          : { borderColor: '#E5E7EB', color: '#6B7280' }}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {mine.some((m) => m.note) && (
              <p className="text-xs text-neutral-500">
                Note: {mine.find((m) => m.note)?.note}
              </p>
            )}
          </div>
        )}

        {/* Simple poll, or a closed availability poll: the tally. */}
        {(poll.type !== 'availability' || !poll.is_open || mine.length === 0) && (
          <div className="mt-3 flex flex-col gap-1.5">
            {results.map((r) => {
              const pct = total === 0 ? 0 : Math.round((r.votes / total) * 100)
              return (
                <button
                  key={r.option_id}
                  onClick={() => poll.is_open && poll.type !== 'availability' && vote(r.option_id, null)}
                  disabled={!poll.is_open || poll.type === 'availability' || busy === 'me'}
                  className="relative overflow-hidden rounded-lg border px-2.5 py-2 text-left text-sm disabled:cursor-default"
                  style={{ borderColor: r.voted_by_me ? '#202842' : '#E5E7EB' }}
                >
                  <span className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: '#2028420f' }} />
                  <span className="relative flex justify-between gap-2">
                    <span className={r.voted_by_me ? 'font-semibold' : ''}>{r.label}</span>
                    <span className="tabular-nums text-neutral-500">{r.votes}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {poll.anonymous && (
          <p className="mt-2 text-xs text-neutral-500">
            {/* Say it on the card. Nobody reads a setting they cannot see. */}
            Answers are anonymous — even to the coach.
          </p>
        )}

        {isHost && missing.length > 0 && (
          <div className="mt-3 border-t border-neutral-100 pt-2">
            <button
              onClick={() => setShowMissing((v) => !v)}
              className="text-xs font-semibold"
              style={{ color: '#DD5620' }}
            >
              {missing.length} still to answer {showMissing ? '▾' : '▸'}
            </button>
            {showMissing && (
              <p className="mt-1 text-xs text-neutral-600">
                {missing.map((m) => m.player_name ?? m.full_name).join(', ')}
              </p>
            )}
          </div>
        )}

        {isHost && poll.type === 'availability' && !poll.linked_event_id && (
          <p className="mt-2 text-xs text-neutral-500">
            When you make this a fixture, everyone&apos;s answer comes with it.
          </p>
        )}
      </div>
    </div>
  )
}
