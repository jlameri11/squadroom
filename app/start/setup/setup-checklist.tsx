'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { getOrg } from '@/lib/org'
import { prepareImage } from '@/lib/adapters/images'
import { ScreenSkeleton } from '@/components/screen-skeleton'

type Step = { id: string; label: string; done: boolean; href: string; detail: string | null }
type Progress = {
  academy_id: string
  name: string
  slug: string
  primary_colour: string | null
  logo_url: string | null
  started_at: string
  completed_at: string | null
  minutes: number
  /** Set up before the checklist existed; the clock means nothing. */
  grandfathered?: boolean
  steps: Step[]
  done: number
  total: number
  complete: boolean
}

const SWATCHES = ['#202842', '#0B5FFF', '#C8102E', '#006B3F', '#F58220', '#5B2C83', '#111111', '#0E7490']

/**
 * G-01: set up a club in under thirty minutes.
 *
 * Six steps, read from the data (a squad is done when a squad exists, not
 * when somebody ticks a box): crest and colours here, the rest one tap away
 * on the pages that already do them. The clock at the top is the point —
 * the thirty minutes is a promise we keep by measuring it on every club.
 */
export function SetupChecklist() {
  const [p, setP] = useState<Progress | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [colour, setColour] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await createClient().rpc('setup_progress', { p_academy: getOrg() ?? undefined })
    const r = (data as unknown as Progress | null) ?? null
    setP(r)
    if (r?.primary_colour) setColour(r.primary_colour)
  }, [])

  useEffect(() => {
    ;(async () => {
      await load()
    })()
  }, [load])

  async function saveColour(c: string) {
    if (!p) return
    setBusy('colour')
    setError(null)
    setColour(c)
    const { error } = await createClient().from('academies').update({ primary_colour: c }).eq('id', p.academy_id)
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  async function uploadCrest(f: File | null) {
    if (!f || !p) return
    setBusy('crest')
    setError(null)
    const supabase = createClient()
    const prepared = await prepareImage(f)
    const ext = prepared.mime === 'image/png' ? 'png' : prepared.mime === 'image/svg+xml' ? 'svg' : prepared.mime === 'image/webp' ? 'webp' : 'jpg'
    const path = `${p.academy_id}/crest-${Date.now()}.${ext}`
    const { error: up } = await supabase.storage.from('club-logos').upload(path, prepared.blob, { contentType: prepared.mime, upsert: true })
    if (up) {
      setBusy(null)
      return setError(up.message)
    }
    const url = supabase.storage.from('club-logos').getPublicUrl(path).data.publicUrl
    const { error } = await supabase.rpc('set_academy_logo', { p_academy: p.academy_id, p_url: url })
    setBusy(null)
    if (error) return setError(error.message)
    await load()
  }

  if (p === undefined) return <ScreenSkeleton />
  if (p === null) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="card p-5 text-center text-sm text-ink-2">
          Setting up is for a club&apos;s owner or admin. <Link href="/" className="underline">Home</Link>
        </p>
      </main>
    )
  }

  const tint = p.primary_colour || 'var(--brand)'
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col" style={{ '--brand': tint } as React.CSSProperties} data-setup>
      <header className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3.5 pt-3" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
        {p.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.logo_url} alt="" className="h-9 w-9 flex-none rounded-[10px] bg-white object-contain p-0.5" />
        ) : (
          <span className="display grid h-9 w-9 flex-none place-items-center rounded-[10px] text-[0.9375rem]" style={{ background: '#ffffff26' }}>
            {p.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[1.3125rem] leading-tight">Set up {p.name}</span>
          <span className="block truncate text-xs opacity-75" data-setup-clock>
            {p.grandfathered
              ? `${p.done} of ${p.total} in place`
              : p.complete
                ? `Set up in ${p.minutes} min${p.minutes <= 30 ? ' — under the half hour' : ''}`
                : `${p.done} of ${p.total} done · ${p.minutes} min so far · aim for under 30`}
          </span>
        </span>
        <Link href="/" className="flex-none rounded-[10px] px-2.5 py-1.5 text-xs font-semibold" style={{ background: '#ffffff26' }}>
          {p.complete ? 'Done' : 'Later'}
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-3.5 pb-8 pt-4">
        {/* Step 1, inline: the colour and the crest. */}
        <section className="card p-3.5" id="brand">
          <div className="flex items-center justify-between">
            <span className="font-semibold">1 · Crest and colours</span>
            <span className="pill" style={p.steps[0]?.done ? { background: 'var(--yes-bg)', color: 'var(--yes)' } : undefined}>{p.steps[0]?.done ? 'Done' : 'To do'}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">The colour is the app bar on every screen; the crest goes on your public page and in the corner.</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {SWATCHES.map((s) => (
              <button key={s} onClick={() => saveColour(s)} disabled={busy === 'colour'} aria-label={`Colour ${s}`} className="h-8 w-8 rounded-full border-2" style={{ background: s, borderColor: colour.toLowerCase() === s.toLowerCase() ? 'var(--ink)' : 'transparent' }} />
            ))}
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="color" value={colour || '#202842'} onChange={(e) => setColour(e.target.value)} onBlur={(e) => saveColour(e.target.value)} className="h-8 w-10 rounded border-0 bg-transparent p-0" aria-label="Your own colour" />
              your own
            </label>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { uploadCrest(e.target.files?.[0] ?? null); e.target.value = '' }} />
            <button onClick={() => file.current?.click()} disabled={busy === 'crest'} className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }} data-crest>
              {busy === 'crest' ? 'Uploading…' : p.logo_url ? 'Change the crest' : 'Add the crest'}
            </button>
            <span className="text-xs text-ink-3">One picture, PNG or JPG. Pick the file; we never ask for your whole photo library.</span>
          </div>
        </section>

        {/* Steps 2–6: one tap to the page that does it. */}
        <ul className="card mt-3 divide-y overflow-hidden" style={{ borderColor: 'var(--line-2)' }}>
          {p.steps.slice(1).map((s, i) => (
            <li key={s.id}>
              <Link href={s.href} className="flex items-center gap-3 px-3.5 py-3" data-step={s.id}>
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold" style={s.done ? { background: 'var(--yes)', color: '#fff' } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                  {s.done ? '✓' : i + 2}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{s.label}</span>
                  <span className="block truncate text-xs text-ink-3">{s.detail}</span>
                </span>
                <span className="flex-none text-ink-3">›</span>
              </Link>
            </li>
          ))}
        </ul>

        {p.complete && !p.grandfathered ? (
          <p className="mt-4 rounded-xl p-3.5 text-sm" style={{ background: 'var(--yes-bg)', color: 'var(--yes)' }} data-setup-complete>
            That is the club set up — {p.minutes} minutes. Your public page is live at <b>/{p.slug}</b>; families register there and coaches join from their links.
          </p>
        ) : p.grandfathered ? (
          <p className="mt-4 px-1 text-xs text-ink-3">Your public page is at <b>/{p.slug}</b>. Anything unticked above is one tap away.</p>
        ) : (
          <p className="mt-4 px-1 text-xs text-ink-3">Come back here from Home any time; the ticks come from what is in the club, not from this list.</p>
        )}
        {error && <p className="mt-2 text-xs" style={{ color: 'var(--no)' }}>{error}</p>}
      </div>
    </main>
  )
}
