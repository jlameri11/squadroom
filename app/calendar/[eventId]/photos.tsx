'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prepareImage, THUMB } from '@/lib/adapters/images'
import { Sheet } from '@/components/sheet'
import { PhotoConsentWarning, type PhotoConsentCheck } from '@/components/photo-consent-warning'

type Photo = {
  id: string
  path: string
  thumb: string
  width: number | null
  height: number | null
  at: string
  by: string | null
  hidden: boolean
  hidden_by: string | null
}
type Data = { can_add: boolean; played: boolean; limit: number; consent: PhotoConsentCheck | null; photos: Photo[] }

const BUCKET = 'match-photos'
const LIFE_S = 3600

/**
 * The game's photos (M5, 0223), under the video on the Match sheet. The
 * squad's coach adds them; the squad's people see them; nothing about them
 * is public. A grid of small copies, the full photo when tapped.
 *
 * Photographs of children, so: the coach is shown who in the squad must not
 * be photographed at the moment they add them (the chat's warning, 0128),
 * and anyone in the squad can take a photo down at once — it disappears for
 * everyone but the coaches, who are told and who put it back or delete it.
 */
export function MatchPhotos({ eventId }: { eventId: string }) {
  const [d, setD] = useState<Data | null | undefined>(undefined)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Photo | null>(null)
  const [picked, setPicked] = useState<File[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sure, setSure] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('match_photos', { p_event: eventId })
    // Not this squad's game, or the database does not have photos yet: nothing to show.
    const next = error ? null : (data as unknown as Data)
    setD(next)
    if (!next || next.photos.length === 0) return setUrls({})
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(next.photos.map((p) => p.thumb), LIFE_S)
    const map: Record<string, string> = {}
    for (const s of signed ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl
    setUrls(map)
  }, [eventId])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  // The full photo, made when it is opened.
  useEffect(() => {
    if (!open || urls[open.path]) return
    let live = true
    createClient()
      .storage.from(BUCKET)
      .createSignedUrl(open.path, LIFE_S)
      .then(({ data }) => {
        if (live && data?.signedUrl) setUrls((u) => ({ ...u, [open.path]: data.signedUrl }))
      })
    return () => {
      live = false
    }
  }, [open, urls])

  if (!d || !d.played) return null
  if (!d.can_add && d.photos.length === 0) return null

  const room = d.limit - d.photos.length

  async function addPicked() {
    if (picked.length === 0) return
    if (picked.length > room) return setError(`A game keeps ${d!.limit} photos. ${room} more fit — pick fewer.`)
    setBusy('add')
    setError(null)
    const supabase = createClient()
    const { data: ev } = await supabase.from('events').select('academy_id').eq('id', eventId).single()
    const dir = `${ev?.academy_id}/${eventId}`
    const done: { path: string; thumb: string | null; width: number; height: number }[] = []
    let failed = 0
    for (const [i, file] of picked.entries()) {
      setProgress(`Uploading ${i + 1} of ${picked.length}…`)
      const id = crypto.randomUUID()
      const full = await prepareImage(file)
      const small = await prepareImage(file, THUMB)
      const ext = full.mime === 'image/jpeg' ? 'jpg' : (full.mime.split('/')[1] ?? 'jpg').replace(/[^a-z0-9]/g, '')
      const path = `${dir}/${id}.${ext}`
      const { error: up } = await supabase.storage.from(BUCKET).upload(path, full.blob, { contentType: full.mime, upsert: false })
      if (up) {
        failed += 1
        continue
      }
      // A thumbnail only when the phone could make one; otherwise the grid shows the photo itself.
      let thumb: string | null = null
      if (small.mime === 'image/jpeg' && small.width > 0) {
        const t = `${dir}/${id}.thumb.jpg`
        const { error: upThumb } = await supabase.storage.from(BUCKET).upload(t, small.blob, { contentType: 'image/jpeg', upsert: false })
        if (!upThumb) thumb = t
      }
      done.push({ path, thumb, width: full.width, height: full.height })
    }
    setProgress(null)
    if (done.length > 0) {
      const { error } = await supabase.rpc('add_match_photos', { p_event: eventId, p_photos: done as never })
      if (error) {
        setBusy(null)
        return setError(error.message)
      }
    }
    setBusy(null)
    setPicked([])
    if (failed > 0) setError(`${failed} ${failed === 1 ? 'photo' : 'photos'} did not upload. Try ${failed === 1 ? 'it' : 'them'} again.`)
    await load()
  }

  async function takeDown(p: Photo) {
    setBusy('down')
    setError(null)
    const { error } = await createClient().rpc('take_down_match_photo', { p_photo: p.id })
    setBusy(null)
    setSure(false)
    if (error) return setError(error.message)
    setOpen(null)
    await load()
  }
  async function putBack(p: Photo) {
    setBusy('back')
    const { error } = await createClient().rpc('restore_match_photo', { p_photo: p.id })
    setBusy(null)
    if (error) return setError(error.message)
    setOpen(null)
    await load()
  }
  async function remove(p: Photo) {
    setBusy('delete')
    const supabase = createClient()
    const { data, error } = await supabase.rpc('remove_match_photo', { p_photo: p.id })
    if (!error) {
      const files = ((data as unknown as { files?: string[] })?.files ?? []).filter(Boolean)
      if (files.length) await supabase.storage.from(BUCKET).remove(files)
    }
    setBusy(null)
    setSure(false)
    if (error) return setError(error.message)
    setOpen(null)
    await load()
  }

  const shown = d.photos.filter((p) => !p.hidden || d.can_add)
  const line = { borderColor: 'var(--line)' }

  return (
    <section className="mt-4" data-match-photos>
      <div className="sect">
        <span className="eyebrow">Photos{shown.length ? ` · ${shown.length}` : ''}</span>
        {d.can_add && room > 0 && picked.length === 0 && (
          <label className="tap cursor-pointer text-xs" style={{ color: 'var(--brand-text)' }}>
            {d.photos.length ? 'Add more' : 'Add photos'}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                setPicked([...(e.target.files ?? [])])
                setError(null)
                e.target.value = ''
              }}
              data-photos-file
            />
          </label>
        )}
      </div>
      <div className="card p-3">
        {d.can_add && picked.length > 0 && (
          <div className="mb-3" data-photos-ready>
            <p className="text-sm font-semibold">
              {picked.length} {picked.length === 1 ? 'photo' : 'photos'} ready
            </p>
            {d.consent && <PhotoConsentWarning check={d.consent} className="mt-2" />}
            <p className="mt-2 text-[0.6875rem] text-ink-3">
              Only this squad sees them, and its families get one push. Anyone in the squad can take a photo down; you will be told.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={addPicked}
                disabled={busy !== null}
                className="min-w-fit flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
                data-photos-add
              >
                {progress ?? (busy === 'add' ? 'Adding…' : `Add ${picked.length} ${picked.length === 1 ? 'photo' : 'photos'}`)}
              </button>
              <button onClick={() => setPicked([])} disabled={busy !== null} className="min-w-fit rounded-lg border px-3 py-2 text-sm" style={line}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          picked.length === 0 && <p className="text-sm text-ink-3">No photos yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-1.5" data-photo-grid>
            {shown.map((p, i) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    setOpen(p)
                    setSure(false)
                  }}
                  className="relative block aspect-square w-full overflow-hidden rounded-lg"
                  style={{ background: 'var(--surface-2)' }}
                  aria-label={`Photo ${i + 1} of ${shown.length}${p.hidden ? ', taken down' : ''}`}
                  data-photo={p.id}
                  data-hidden={p.hidden || undefined}
                >
                  {urls[p.thumb] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[p.thumb]} alt="" className="h-full w-full object-cover" style={{ opacity: p.hidden ? 0.35 : 1 }} loading="lazy" />
                  )}
                  {p.hidden && (
                    <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-center text-[0.6875rem] font-semibold" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>
                      Taken down
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>

      {open && (
        <Sheet onClose={() => setOpen(null)}>
          <div data-photo-viewer>
            <div className="grid min-h-[12rem] place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)' }}>
              {urls[open.path] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[open.path]} alt="A photo from the game" className="max-h-[60dvh] w-full object-contain" />
              ) : (
                <span className="text-sm text-ink-3">Loading the photo…</span>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              {open.by ? `Added by ${open.by} · ` : ''}
              {new Date(open.at).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
            </p>

            {open.hidden && d.can_add && (
              <p className="mt-2 rounded-lg p-2.5 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }} data-taken-down>
                Taken down{open.hidden_by ? ` by ${open.hidden_by}` : ''}. Only the squad&apos;s coaches can see it. Put it back if it should be up, or delete it.
              </p>
            )}

            {sure ? (
              <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--no-bg)' }} data-photo-sure>
                <p className="text-sm" style={{ color: 'var(--no)' }}>
                  {d.can_add ? 'Delete this photo for good?' : 'Take this photo down for everyone? The coach is told, and can put it back.'}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    onClick={() => (d.can_add ? remove(open) : takeDown(open))}
                    disabled={busy !== null}
                    className="min-w-fit flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-no-ink disabled:opacity-50"
                    style={{ background: 'var(--no)' }}
                    data-photo-confirm
                  >
                    {busy ? '…' : d.can_add ? 'Delete it' : 'Take it down'}
                  </button>
                  <button onClick={() => setSure(false)} disabled={busy !== null} className="min-w-fit rounded-xl border px-4 py-2.5 text-sm font-semibold" style={line}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {open.hidden && d.can_add && (
                  <button
                    onClick={() => putBack(open)}
                    disabled={busy !== null}
                    className="min-w-fit flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-50"
                    style={{ background: 'var(--brand)' }}
                    data-photo-restore
                  >
                    {busy === 'back' ? '…' : 'Put it back'}
                  </button>
                )}
                <button
                  onClick={() => setSure(true)}
                  disabled={busy !== null}
                  className="min-w-fit flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"
                  style={{ borderColor: 'var(--no)', color: 'var(--no)' }}
                  data-photo-takedown
                >
                  {d.can_add ? 'Delete' : 'Take it down'}
                </button>
                <button onClick={() => setOpen(null)} className="min-w-fit rounded-xl border px-4 py-2.5 text-sm font-semibold" style={line}>
                  Close
                </button>
              </div>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
