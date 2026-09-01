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
const NAVY = '#202842'

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

  async function handleFile(file: File) {
    setError(null)
    setEvents(null)
    const supabase = createClient()

    try {
      setBusy('Getting the screenshot ready…')
      const blob = await prepareScreenshot(file)

      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) throw new Error('You are signed out. Sign in and try again.')

      // {academy_id}/{profile_id}/{file} — the storage policies read both out
      // of the path, so this shape is not cosmetic.
      const path = `${academyId}/${auth.user.id}/${crypto.randomUUID()}.jpg`

      setBusy('Uploading…')
      const { error: uploadError } = await supabase.storage
        .from('scans')
        .upload(path, blob, { contentType: blob.type || 'image/jpeg' })
      if (uploadError) throw new Error(uploadError.message)

      const { data: scan, error: scanError } = await supabase
        .from('event_scans')
        .insert({
          academy_id: academyId,
          profile_id: auth.user.id,
          storage_path: path,
          team_id: shareTeam || null,
          share: !!shareTeam,
        })
        .select('id')
        .single()
      if (scanError || !scan) throw new Error(scanError?.message ?? 'Could not start the scan.')

      setBusy('Reading the fixtures…')
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scanId: scan.id }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'That screenshot could not be read.')

      setEvents(payload.events as ScannedEvent[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto max-w-md p-5">
      <header>
        <h1 className="text-2xl font-semibold" style={{ color: NAVY }}>
          Add games from a screenshot
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Screenshot your draw in Dribl, drop it here, and the games go straight into your
          calendar.
        </p>
      </header>

      {teams.length > 0 && (
        <label className="mt-5 block">
          <span className="text-sm font-medium">Who are these games for?</span>
          <select
            value={shareTeam}
            onChange={(e) => setShareTeam(e.target.value)}
            className="mt-1 w-full rounded-lg border border-neutral-300 p-2.5 text-sm"
          >
            <option value="">Just me — nobody else sees them</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — everyone in the team
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-neutral-500">
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
          const file = e.dataTransfer.files?.[0]
          if (file) void handleFile(file)
        }}
        className={`mt-4 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center ${
          dragging ? 'border-neutral-400 bg-neutral-50' : 'border-neutral-300'
        }`}
      >
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
        {busy ? (
          <span className="text-sm text-neutral-600">{busy}</span>
        ) : (
          <>
            <span className="font-medium" style={{ color: NAVY }}>
              Choose a screenshot
            </span>
            <span className="mt-1 text-sm text-neutral-500">or drag one here</span>
          </>
        )}
      </label>

      {/*
        Said here, before they upload, rather than in a policy page nobody
        opens. A fixture list is harmless; a team sheet with children's names
        on it is not, and people will drop one in eventually.
      */}
      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        The screenshot is sent to Anthropic to be read, then deleted from Squadroom after seven
        days. Times are read as they appear on screen and set in {timezone}. Please don&apos;t
        upload anything with other children&apos;s details on it.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
      <div className="mt-6 rounded-xl border border-neutral-200 p-4">
        <p className="font-medium">No games found in that image.</p>
        <p className="mt-1 text-sm text-neutral-500">
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
      <h2 className="font-semibold" style={{ color: NAVY }}>
        {events.length} {events.length === 1 ? 'game' : 'games'} added
      </h2>
      <p className="mt-0.5 text-sm text-neutral-500">
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
    <li className="rounded-xl border border-neutral-200 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{event.title}</div>
          <div className="mt-0.5 text-sm text-neutral-500">
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
            <div className="mt-1 text-xs text-neutral-400">Only you can see this</div>
          )}
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="flex-none rounded-lg border border-neutral-300 px-2.5 py-1 text-sm"
        >
          {open ? 'Close' : 'Edit'}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-3">
          <Field label="What" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <label className="text-sm">
            <span className="text-neutral-500">Kick-off</span>
            <input
              type="datetime-local"
              value={draft.starts_at}
              onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              className="mt-0.5 w-full rounded-lg border border-neutral-300 p-2"
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
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-red-600"
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
      <span className="text-neutral-500">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-neutral-300 p-2"
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
