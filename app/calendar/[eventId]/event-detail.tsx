'use client'

import { useEffect, useRef, useState } from 'react'
import { WhenOn } from '@/components/when-on'
import { Chase } from './chase'
import { PitchMap } from './pitch-map'
import { MatchDayChecklist } from './match-day-checklist'
import { EventStats } from './stats'
import { LiveScore } from './live'
import { ParentPulse } from './pulse'
import { MatchVideo } from './video'
import { MatchPhotos } from './photos'
import { EventHelpers } from './helpers'
import { DivisionTable } from '@/app/admin/teams/[teamId]/division-table'
import { WhyOut } from '@/components/why-out'
import { Register } from './register'
import { Result } from './result'
import { Lineup } from './lineup'
import { GameHero } from './game-hero'
import { EditOccurrence } from './edit-occurrence'
import { FullLadder, MiniLadder, TeamForm } from './game-panels'
import { useGame } from './use-game'
import { createClient } from '@/lib/supabase/client'
import { sendOrQueue, signedInHere } from '@/lib/offline/use-outbox'
import { gameDay, kickOff } from '@/lib/time'

type Mine = { playerId: string | null; playerName: string | null; status: string | null; note: string | null }
type RosterRow = { playerId: string | null; name: string; status: string | null; note: string | null }
type Tab = 'preview' | 'sheet' | 'ladder'

const CHOICES = [
  { value: 'yes',   label: 'Going', tint: 'var(--yes)' },
  { value: 'maybe', label: 'Maybe', tint: 'var(--maybe)' },
  { value: 'no',    label: 'Out',   tint: 'var(--no)' },
] as const

/**
 * One event. A GAME (a match or a tournament) is laid out like a match
 * preview (Joey, 4 Nov 2026): the hero — both crests, the countdown, then
 * the kick-off, the live score, the result — and three tabs:
 *
 *   Preview      availability first (the Going/Maybe/Out buttons for a
 *                family, who's coming for a coach), then the match details,
 *                the ground and its map, both sides' last five, and their
 *                two rows of the ladder;
 *   Match sheet  the team sheet, the live score, the result, scorers and
 *                Player of the Match, the video, the register;
 *   Ladder       the whole division — only for a game in a competition.
 *
 * Training and everything else keep the plain layout. Every time on the
 * page is the venue's (lib/time.ts), never the phone's or the server's.
 */
export function EventDetail({
  event, mine, isCoach, summary, roster, tz, us,
}: {
  event: {
    id: string; academy_id: string; team_id: string | null; series_id: string | null; type: string; title: string
    description: string | null; starts_at: string; ends_at: string | null
    arrive_at: string | null; venue: string | null; address: string | null
    opponent: string | null; kit_colour: string | null; round: string | null
    notes: string | null; cancelled_at: string | null
    cancellation_reason: string | null; cancellation_note: string | null
    competition_id: string | null; fixture_id: string | null
  }
  mine: Mine[]
  isCoach: boolean
  summary: { going: number; maybe: number; out_count: number; no_reply: number } | null
  roster: RosterRow[]
  /** The venue's timezone: the club's (academies.timezone). */
  tz: string
  /** Our side, for the hero: the club, the squad, the crest. */
  us: { club: string; team: string | null; logo: string | null }
}) {
  const [answers, setAnswers] = useState(mine)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelled = Boolean(event.cancelled_at)
  const isGame = event.type === 'match' || event.type === 'tournament'
  const game = useGame(event, us)

  // The tab: Preview until the game kicks off, then the match sheet — once
  // it has started, what happened is why anybody opens it. A link can name
  // one (#sheet, #ladder), and the choice is kept in the address.
  const [tab, setTab] = useState<Tab>('preview')
  const decided = useRef(false)
  useEffect(() => {
    const fromLink = window.location.hash.replace('#', '')
    if (!decided.current && (fromLink === 'sheet' || fromLink === 'ladder' || fromLink === 'preview')) {
      decided.current = true
      setTab(fromLink as Tab)
    }
  }, [])
  useEffect(() => {
    if (decided.current || !game) return
    decided.current = true
    if (game.live?.kicked_off || game.final) setTab('sheet')
  }, [game])
  const choose = (t: Tab) => {
    decided.current = true
    setTab(t)
    try {
      history.replaceState(null, '', `#${t}`)
    } catch {}
  }

  /**
   * "Out" asks why; the other two save straight away.
   *
   * 0111 requires a reason on 'no', because a coach looking at "4 out" cannot
   * tell a wedding from a sulk and that is the one fact that changes what
   * they do on Saturday. Asking is the whole point — so the tap opens a box
   * rather than failing at the database, which is what would happen if the
   * screen just sent it.
   *
   * Nothing is asked for turning UP. A reason to be available is an
   * interrogation, and a product that asks for one is a product parents start
   * lying to.
   */
  async function answer(playerId: string, status: string, note?: string) {
    if (status === 'no' && !note?.trim()) {
      setAsking(playerId)
      return
    }
    setBusy(playerId)
    setError(null)
    const before = answers
    setAnswers((prev) =>
      prev.map((a) => (a.playerId === playerId ? { ...a, status, note: note?.trim() || null } : a))
    )
    // Who is answering, asked of the phone: with no signal the server cannot
    // say, and asking it threw here, leaving the buttons stuck (X-09).
    const me = await signedInHere()
    if (!me) {
      setBusy(null)
      setError('Not signed in')
      setAnswers(before)
      return
    }
    const outcome = await sendOrQueue({
      kind: 'upsert',
      table: 'event_rsvps',
      rows: [
        {
          academy_id: event.academy_id,
          event_id: event.id,
          profile_id: me,
          player_id: playerId,
          status,
          note: note?.trim() || null,
        },
      ],
      onConflict: 'event_id,profile_id,player_id',
    })
    setBusy(null)
    // A queued answer is saved, so the buttons stay where the parent put
    // them. Only a refusal is a wrong answer on screen.
    if (outcome.status === 'refused') {
      setError(outcome.error)
      // Put the buttons back where they were rather than showing an answer
      // that was not saved. This has to restore the state captured BEFORE the
      // optimistic update — mapping over `prev` can only ever copy what is
      // already on screen, which is the wrong answer.
      setAnswers(before)
      return
    }
    setAsking(null)
  }

  // ---- the pieces, laid out below for a game or for everything else ----

  const details = (
    <>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-match-info>
        <dt className="text-ink-2">When</dt>
        <dd className="tabular-nums">
          {gameDay(event.starts_at, tz)}
          {', '}
          {kickOff(event.starts_at, tz)}
          {event.ends_at && `–${kickOff(event.ends_at, tz)}`}
        </dd>

        {event.arrive_at && (
          <>
            <dt className="text-ink-2">Arrive</dt>
            <dd className="tabular-nums">{kickOff(event.arrive_at, tz)}</dd>
          </>
        )}

        {event.venue && (
          <>
            <dt className="text-ink-2">Where</dt>
            <dd>
              <a
                href={`https://maps.google.com/?q=${encodeURIComponent(event.address ?? event.venue)}`}
                target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2" style={{ color: 'var(--brand-text)' }}
              >
                {event.venue}
              </a>
              {event.address && <span className="block text-ink-2">{event.address}</span>}
            </dd>
          </>
        )}

        {event.opponent && (<><dt className="text-ink-2">Against</dt><dd>{event.opponent}</dd></>)}
        {event.kit_colour && (<><dt className="text-ink-2">Kit</dt><dd>{event.kit_colour}</dd></>)}
      </dl>

      {/* L-29: the ground drawn, their pitch marked, directions. */}
      {event.fixture_id && <PitchMap fixtureId={event.fixture_id} />}

      {event.notes && <p className="mt-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm">{event.notes}</p>}

      <a
        href={`/api/ics/${event.id}`}
        className="mt-4 block rounded-xl border border-[var(--line)] px-4 py-2.5 text-center text-sm font-medium"
      >
        Add to your phone&apos;s calendar
      </a>
    </>
  )

  const yourAnswer = !cancelled && answers.length > 0 && (
    <section className="mt-6" data-your-answer>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        Your answer
      </h2>
      <div className="mt-2 flex flex-col gap-2">
        {answers.map((a) => (
          <div key={a.playerId} className="flex flex-wrap items-center gap-2">
            <span className="w-20 flex-none truncate text-sm font-medium">{a.playerName}</span>
            {/* Drops under the name when larger text no longer fits all three on one line (X-10). */}
            <div className="flex min-w-fit flex-1 gap-1.5">
              {CHOICES.map((c) => {
                const on = a.status === c.value
                return (
                  <button
                    key={c.value}
                    onClick={() => a.playerId && answer(a.playerId, c.value)}
                    disabled={busy === a.playerId}
                    aria-pressed={on}
                    data-choice={c.value}
                    data-player={a.playerId ?? undefined}
                    className="flex-1 rounded-lg border py-2 text-sm font-semibold disabled:opacity-60"
                    style={on
                      ? { borderColor: c.tint, background: `${c.tint}18`, color: c.tint }
                      : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {asking && (
          <WhyOut
            childName={answers.find((a) => a.playerId === asking)?.playerName ?? null}
            busy={busy === asking}
            onSave={(note) => void answer(asking, 'no', note)}
            onCancel={() => setAsking(null)}
          />
        )}

        {error && (
          <p className="text-sm" style={{ color: 'var(--no)' }}>
            {error}
          </p>
        )}
      </div>
    </section>
  )

  const whosComing = isCoach && summary && (
    <section className="mt-6" data-whos-coming>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
        Who&apos;s coming
      </h2>
      <p className="mt-1 text-sm">
        <b style={{ color: 'var(--yes)' }}>{summary.going} in</b> · {summary.maybe} maybe ·{' '}
        {summary.out_count} out · {summary.no_reply} no reply
      </p>

      {/* Right under the tally, because "12 no reply" is the number a
          coach reads and chasing them is what they want to do about it. */}
      <Chase
        eventId={event.id}
        outstanding={summary.no_reply}
        canChase={!event.cancelled_at && new Date(event.starts_at) > new Date()}
      />

      <div className="mt-2 rounded-xl border border-[var(--line)]">
        {roster.map((r, i) => (
          <div key={r.playerId ?? i} className={`flex items-center gap-2 p-3 ${i > 0 ? 'border-t border-[var(--line-2)]' : ''}`}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{r.name}</span>
              {r.note && <span className="block truncate text-xs text-ink-2">“{r.note}”</span>}
            </span>
            <span className="flex-none text-xs font-semibold"
                  style={{ color: CHOICES.find((c) => c.value === r.status)?.tint ?? 'var(--ink-3)' }}>
              {CHOICES.find((c) => c.value === r.status)?.label ?? '—'}
            </span>
          </div>
        ))}
        {/* Nothing here when nobody has answered. The summary line
            directly above already says "0 in · 0 maybe · 0 out · 4 no
            reply", and a box repeating it in words is the same fact
            twice in half a screen. */}
      </div>
    </section>
  )

  const register = isCoach && <Register eventId={event.id} started={new Date(event.starts_at) <= new Date()} />

  const result = !cancelled && (
    <Result
      eventId={event.id}
      opponent={event.opponent}
      isCoach={isCoach}
      played={new Date(event.starts_at) <= new Date()}
      inCompetition={Boolean(event.fixture_id)}
    />
  )

  if (!isGame) {
    return (
      <>
        <header className="mt-3">
          <div className="flex items-center gap-2">
            <span className="rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide"
                  style={{ background: cancelled ? 'var(--no)' : 'var(--brand)', color: cancelled ? 'var(--no-ink)' : 'var(--brand-ink)' }}>
              {cancelled ? 'Cancelled' : event.type}
            </span>
            {event.round && <span className="text-sm text-ink-2">{event.round}</span>}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold">{event.title}</h1>
        </header>
        {details}
        {/* G-07: the jobs the day needs, and who has put their name down. */}
        {!cancelled && <WhenOn feature="helpers"><EventHelpers eventId={event.id} clubWide={!event.team_id} /></WhenOn>}
        {result}
        {isCoach && <EditOccurrence event={event} tz={tz} />}
        {isCoach && <CallItOff event={event} />}
        {yourAnswer}
        {/* Before the tally, because once a session has started the register is
            what a coach came here to do — the RSVP summary is what they looked
            at beforehand. */}
        {register}
        {whosComing}
      </>
    )
  }

  const label = [event.round, game?.competition ?? (event.type === 'tournament' ? 'Tournament' : 'Match')].filter(Boolean).join(' · ')
  const ourName = us.team ? `${us.team}` : us.club
  const theirName = game ? (game.usOnLeft ? game.right.name : game.left.name) : event.opponent ?? 'Opposition'
  const inCompetition = Boolean(event.fixture_id && game?.ladder)
  const TABS: { id: Tab; label: string }[] = [
    { id: 'preview', label: 'Preview' },
    { id: 'sheet', label: 'Match sheet' },
    ...(inCompetition ? [{ id: 'ladder' as const, label: 'Ladder' }] : []),
  ]

  return (
    <>
      <h1 className="sr-only">{event.title}</h1>
      <GameHero
        startsAt={event.starts_at}
        cancelled={cancelled}
        label={label}
        venue={event.venue}
        tz={tz}
        game={game}
        fallbackLeft={{ name: us.club, sub: us.team, logo: us.logo }}
        fallbackRight={{ name: event.opponent ?? 'Opposition', sub: null, logo: null }}
      />

      {/* Equal widths on one line; two lines when larger text no longer fits them (X-10). */}
      <div className="mt-3 flex flex-wrap gap-1.5 rounded-xl p-1" style={{ background: 'var(--surface-2)' }} role="tablist" aria-label="This game">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => choose(t.id)}
            className="min-w-fit flex-1 rounded-lg px-3 py-2 text-sm font-semibold"
            style={tab === t.id ? { background: 'var(--surface)', color: 'var(--ink)', boxShadow: '0 1px 2px #0000001a' } : { color: 'var(--ink-2)' }}
            data-tab={t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'preview' && (
        <div data-panel="preview">
          {/* Availability first, for a family and for a coach (Joey, 4 Nov). */}
          {yourAnswer}
          {whosComing}
          {/* F-07: the coach's match-day list — what ticks itself and what to tick. */}
          {!cancelled && isCoach && event.type === 'match' && <MatchDayChecklist eventId={event.id} />}
          {details}
          {/* G-07: the canteen, a linesman — before kick-off, where a parent looks. */}
          {!cancelled && <WhenOn feature="helpers"><EventHelpers eventId={event.id} clubWide={!event.team_id} /></WhenOn>}
          {game && <TeamForm game={game} ourName={ourName} theirName={theirName} />}
          {game && <MiniLadder game={game} onOpen={() => choose('ladder')} />}
          {/* F-05 (0228): the division table from the league's file, for a game outside our own competitions. */}
          {event.team_id && !game?.ladder && <DivisionTable teamId={event.team_id} />}
          {isCoach && <EditOccurrence event={event} tz={tz} />}
          {isCoach && <CallItOff event={event} />}
        </div>
      )}

      {tab === 'sheet' && (
        <div data-panel="sheet">
          {/* Who is playing, then what happened: the order of a match day.
              Renders nothing for a family until the coach publishes. */}
          {!cancelled && <Lineup eventId={event.id} canSee={isCoach} />}
          {/* X-01: the game as it happens — the coach taps, the chat and the timeline follow. */}
          {!cancelled && <LiveScore eventId={event.id} />}
          {result}
          {/* X-02 / X-03: who scored, who starred — after the whistle. */}
          {!cancelled && <EventStats eventId={event.id} />}
          {/* Matchdays: the game video — a link or an upload, the squad's own. */}
          {!cancelled && <WhenOn feature="match_video"><MatchVideo eventId={event.id} /></WhenOn>}
          {/* M5: the game's photos — the squad's own, and any of them can take one down. */}
          {!cancelled && <WhenOn feature="match_photos"><MatchPhotos eventId={event.id} /></WhenOn>}
          {/* X-11: how was today? One tap from the family; the coaches see it. */}
          {!cancelled && <ParentPulse eventId={event.id} />}
          {register}
        </div>
      )}

      {tab === 'ladder' && game && (
        <div data-panel="ladder">
          <FullLadder game={game} />
        </div>
      )}
    </>
  )
}

const REASONS = [
  { value: 'wet_weather', label: 'Wet weather' },
  { value: 'ground_closed', label: 'Ground closed' },
  { value: 'not_enough_players', label: 'Not enough players' },
  { value: 'forfeit', label: 'Forfeit' },
  { value: 'other', label: 'Something else' },
] as const

/**
 * Calling a game off, and putting it back on.
 *
 * This is the highest-consequence button in the product: pressing it wakes
 * every phone in the team, and inside 24 hours it also sends a text. So it
 * asks for a reason before it will do anything — "cancelled" and "the council
 * shut the ground" are different messages to somebody already loading the car
 * — and it says plainly how many people are about to be interrupted.
 */
function CallItOff({
  event,
}: {
  event: {
    id: string
    type: string
    title: string
    starts_at: string
    cancelled_at: string | null
    cancellation_reason: string | null
    cancellation_note: string | null
  }
}) {
  // A coach calling off Thursday's training was asked to "call this game
  // off". The word follows the thing.
  const noun = event.type === 'match' || event.type === 'tournament' ? 'game' : event.type === 'training' ? 'session' : 'event'
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('wet_weather')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = Boolean(event.cancelled_at)

  // Inside 24 hours the notification escalates to SMS, and a coach should
  // know that before pressing rather than after the bill.
  const soon =
    new Date(event.starts_at).getTime() - Date.now() < 24 * 3600 * 1000 &&
    new Date(event.starts_at).getTime() > Date.now() - 3 * 3600 * 1000

  async function set(cancel: boolean) {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase
      .from('events')
      .update(
        cancel
          ? {
              cancelled_at: new Date().toISOString(),
              cancellation_reason: reason,
              cancellation_note: note.trim() || null,
            }
          : { cancelled_at: null, cancellation_reason: null, cancellation_note: null }
      )
      .eq('id', event.id)
    setBusy(false)
    if (error) return setError(error.message)
    window.location.reload()
  }

  if (cancelled) {
    return (
      <section className="mt-5 rounded-xl border   p-4">
        <p className="text-sm font-semibold ">This {noun} is off</p>
        {(event.cancellation_reason || event.cancellation_note) && (
          <p className="mt-0.5 text-sm ">
            {REASONS.find((r) => r.value === event.cancellation_reason)?.label}
            {event.cancellation_note ? ` — ${event.cancellation_note}` : ''}
          </p>
        )}
        <p className="mt-1 text-xs ">Everyone in the team has been told.</p>
        <button
          onClick={() => set(false)}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-red-300 bg-[var(--surface)] px-4 py-2.5 text-sm font-medium"
        >
          {busy ? 'Working…' : "It's back on"}
        </button>
        {error && <p className="mt-2 text-sm ">{error}</p>}
      </section>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        // Drawn as the destructive thing it is. It sat directly under "Add
        // to your phone's calendar" in an identical outlined button —
        // identical weight, identical colour — and one of the two notifies
        // every family in the squad, past their quiet hours, with no way to
        // mute it. Three equal buttons made the dangerous one the easiest to
        // press by accident.
        className="mt-5 w-full rounded-xl border px-4 py-3 text-sm font-semibold"
        style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
      >
        Call this {noun} off
      </button>
    )
  }

  return (
    <section className="mt-5 rounded-xl border border-[var(--line)] p-4">
      <h2 className="font-semibold">Call this {noun} off</h2>
      <p className="mt-1 text-sm text-ink-2">
        Everyone in the team gets a notification straight away, whether or not they
        RSVP&apos;d and whatever their quiet hours are set to.
        {soon && ' Because it is within 24 hours, they also get a text message.'}
      </p>

      <label className="mt-3 block text-sm">
        <span className="text-ink-2">Why</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block text-sm">
        <span className="text-ink-2">Anything to add (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Council closed all grounds — training Tuesday as normal"
          className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
        />
      </label>

      {error && <p className="mt-2 text-sm ">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => set(true)}
          disabled={busy}
          className="flex-1 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Telling everyone…' : 'Call it off and tell everyone'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm"
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
