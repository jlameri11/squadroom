'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export type CoachedTeam = { id: string; name: string }

type ScannedEvent = {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  arrive_at: string | null
  venue: string | null
  address: string | null
  opponent: string | null
  round: string | null
  team_id: string | null
  private_to: string | null
}

const MAX_EDGE = 2200 // Small print on a fixture list has to survive this.
/** A fill keeps the club's colour; text uses INK. See --brand-text. */
const NAVY = 'var(--brand)'
const INK = 'var(--brand-text)'

// A season draw is rarely one screenshot — it is the four or five it took to
// scroll through the round. Ten is comfortably more than that, and it is also
// the point past which someone is no longer adding fixtures.
const MAX_BATCH = 10

// Each image is its own API call, and ten at once from a phone on suburban
// wifi is how you get timeouts. Three at a time finishes a full batch in
// about the same wall-clock time without the failures.
const CONCURRENCY = 3

/**
 * Downsized, but not as hard as a chat photo. images.ts caps at 1600px
 * because nobody needs more to see a goal; here the whole point is reading
 * six-point text, and an over-compressed screenshot produces a confident
 * wrong time.
 */
async function prepareScreenshot(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
  return blob && blob.size < file.size ? blob : file
}

export function ScanClient({
  academyId,
  academyName,
  timezone,
  teams,
}: {
  academyId: string
  academyName: string
  timezone: string
  teams: CoachedTeam[]
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<ScannedEvent[] | null>(null)
  const [shareTeam, setShareTeam] = useState<string>('')
  const [dragging, setDragging] = useState(false)

  async function handleFiles(chosen: File[]) {
    setError(null)
    setEvents(null)

    const images = chosen.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setError('Those files are not images.')
      return
    }

    // Said out loud rather than silently taking the first ten. Someone who
    // selected fourteen screenshots needs to know four of them were dropped.
    const batch = images.slice(0, MAX_BATCH)
    const ignored = images.length - batch.length

    const supabase = createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      setError('You are signed out. Sign in and try again.')
      return
    }

    let done = 0
    const collected: ScannedEvent[] = []
    const failures: string[] = []
    setBusy(`Reading ${batch.length} ${batch.length === 1 ? 'screenshot' : 'screenshots'}…`)

    async function readOne(file: File) {
      try {
        const blob = await prepareScreenshot(file)

        // {academy_id}/{profile_id}/{file} — the storage policies read both
        // out of the path, so this shape is not cosmetic.
        const path = `${academyId}/${auth.user!.id}/${crypto.randomUUID()}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('scans')
          .upload(path, blob, { contentType: blob.type || 'image/jpeg' })
        if (uploadError) throw new Error(uploadError.message)

        const { data: scan, error: scanError } = await supabase
          .from('event_scans')
          .insert({
            academy_id: academyId,
            profile_id: auth.user!.id,
            storage_path: path,
            team_id: shareTeam || null,
            share: !!shareTeam,
          })
          .select('id')
          .single()
        // The daily cap lives in a database trigger, so this is where hitting
        // it surfaces — as a plain sentence, not a Postgres error code.
        if (scanError || !scan) throw new Error(scanError?.message ?? 'Could not start the scan.')

        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scanId: scan.id }),
        })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error ?? 'That screenshot could not be read.')

        collected.push(...(payload.events as ScannedEvent[]))
      } catch (err) {
        failures.push(err instanceof Error ? err.message : 'Something went wrong.')
      } finally {
        done++
        setBusy(`Read ${done} of ${batch.length}…`)
      }
    }

    // A small worker pool rather than Promise.all over all ten.
    const queue = [...batch]
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        let next = queue.shift()
        while (next) {
          await readOne(next)
          next = queue.shift()
        }
      })
    )

    setBusy(null)
    collected.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    setEvents(collected)

    const notes: string[] = []
    if (ignored > 0) {
      notes.push(`Only the first ${MAX_BATCH} were read — ${ignored} left out.`)
    }
    if (failures.length > 0) {
      // One distinct reason is worth showing; five copies of it is not.
      notes.push(
        failures.length === batch.length
          ? failures[0]
          : `${failures.length} of ${batch.length} could not be read: ${failures[0]}`
      )
    }
    if (notes.length > 0) setError(notes.join(' '))
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <header>
        <h1 className="text-2xl font-semibold" style={{ color: INK }}>
          Add games from a screenshot
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Screenshot your draw in Dribl, drop them here, and the games go straight into your
          calendar. A whole round usually takes a few screenshots — add them all at once.
        </p>
      </header>

      {teams.length > 0 && (
        <label className="mt-5 block">
          <span className="text-sm font-medium">Who are these games for?</span>
          <select
            value={shareTeam}
            onChange={(e) => setShareTeam(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--line)] p-2.5 text-sm"
          >
            <option value="">Just me — nobody else sees them</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — everyone in the team
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-ink-2">
            {shareTeam
              ? 'These become team fixtures, and parents can RSVP to them.'
              : `Private to you. Nobody else at ${academyName} will see them.`}
          </span>
        </label>
      )}

      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length > 0) void handleFiles(files)
        }}
        className={`mt-4 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${
          dragging ? 'border-[var(--ink-3)] bg-[var(--surface-3)]' : 'border-[var(--line)]'
        }`}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void handleFiles(files)
            e.target.value = ''
          }}
        />
        {busy ? (
          <span className="text-sm text-ink-2">{busy}</span>
        ) : (
          <>
            <span className="font-medium" style={{ color: INK }}>
              Choose screenshots
            </span>
            <span className="mt-1 text-sm text-ink-2">
              or drag them here — up to {MAX_BATCH} at a time
            </span>
          </>
        )}
      </label>

      {/*
        Said here, before they upload, rather than in a policy page nobody
        opens. A fixture list is harmless; a team sheet with children's names
        on it is not, and people will drop one in eventually.
      */}
      <p className="mt-3 text-xs leading-relaxed text-ink-2">
        The screenshot is sent to Anthropic to be read, then deleted from Squadroom after seven
        days. Times are read as they appear on screen and set in {timezone}. Please don&apos;t
        upload anything with other children&apos;s details on it.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border p-3 text-sm " style={{ background: 'var(--no-bg)', borderColor: 'var(--no)', color: 'var(--no)' }}>
          {error}
        </p>
      )}

      {events && <Results events={events} setEvents={setEvents} />}
    </main>
  )
}

function Results({
  events,
  setEvents,
}: {
  events: ScannedEvent[]
  setEvents: (e: ScannedEvent[]) => void
}) {
  if (events.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-[var(--line)] p-4">
        <p className="font-medium">No games found in that image.</p>
        <p className="mt-1 text-sm text-ink-2">
          A screenshot of the draw itself usually works better than a photo of a screen. You can
          also{' '}
          <Link href="/calendar" className="underline underline-offset-4">
            add the game by hand
          </Link>
          .
        </p>
      </div>
    )
  }

  return (
    <section className="mt-6">
      <h2 className="font-semibold" style={{ color: INK }}>
        {events.length} {events.length === 1 ? 'game' : 'games'} added
      </h2>
      <p className="mt-0.5 text-sm text-ink-2">
        These are in your calendar already. Check the times against the screenshot — a machine read
        them.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            onChange={(next) => setEvents(events.map((e) => (e.id === next.id ? next : e)))}
            onRemove={() => setEvents(events.filter((e) => e.id !== event.id))}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * Every field the model could have got wrong, editable in place. It created
 * the event outright, so the honest thing is to put the correction one tap
 * away rather than behind a separate edit screen.
 */
function EventRow({
  event,
  onChange,
  onRemove,
}: {
  event: ScannedEvent
  onChange: (e: ScannedEvent) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({
    title: event.title,
    // datetime-local wants the browser's own local time, which is the phone's
    // timezone. For a parent standing in Sydney that is the club's timezone.
    starts_at: toLocalInput(event.starts_at),
    venue: event.venue ?? '',
    opponent: event.opponent ?? '',
  })

  const when = new Date(event.starts_at)

  async function save() {
    setSaving(true)
    const supabase = createClient()
    const startsAt = new Date(draft.starts_at)
    const { data, error } = await supabase
      .from('events')
      .update({
        title: draft.title,
        starts_at: startsAt.toISOString(),
        venue: draft.venue || null,
        opponent: draft.opponent || null,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', event.id)
      .select(
        'id, title, starts_at, ends_at, arrive_at, venue, address, opponent, round, team_id, private_to'
      )
      .single()
    setSaving(false)
    if (!error && data) {
      onChange(data as ScannedEvent)
      setOpen(false)
    }
  }

  async function remove() {
    const supabase = createClient()
    await supabase.from('events').delete().eq('id', event.id)
    onRemove()
  }

  return (
    <li className="rounded-xl border border-[var(--line)] p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{event.title}</div>
          <div className="mt-0.5 text-sm text-ink-2">
            {when.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}{' '}
            ·{' '}
            {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            {event.venue ? ` · ${event.venue}` : ''}
          </div>
          {event.private_to && (
            <div className="mt-1 text-xs text-ink-3">Only you can see this</div>
          )}
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="flex-none rounded-lg border border-[var(--line)] px-2.5 py-1 text-sm"
        >
          {open ? 'Close' : 'Edit'}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--line-2)] pt-3">
          <Field label="What" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <label className="text-sm">
            <span className="text-ink-2">Kick-off</span>
            <input
              type="datetime-local"
              value={draft.starts_at}
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
            />
          </label>
          <Field label="Where" value={draft.venue} onChange={(v) => setDraft({ ...draft, venue: v })} />
          <Field
            label="Against"
            value={draft.opponent}
            onChange={(v) => setDraft({ ...draft, opponent: v })}
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: NAVY }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={remove}
              className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm "
            >
              Remove this game
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="text-sm">
      <span className="text-ink-2">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-[var(--line)] p-2"
      />
    </label>
  )
}

function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`
}
