'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ClubPreview } from '@/components/club-preview'
import { clubThemeNotes, inkOn, normaliseHex } from '@/lib/brand/colour'
import { suggestFromImage, type Suggestion } from '@/lib/brand/extract'

/**
 * A club's (or a league's) logo and colours — Settings, owners and admins
 * only (Joey, 4 Nov 2026).
 *
 *   Logo     PNG, SVG or JPG. It replaces the initials tile everywhere: the
 *            app bar, the organisation switcher, the public page, the
 *            registration pages and the share cards. Saved as soon as it is
 *            uploaded, like any file.
 *   Colours  suggested from the logo the moment it is uploaded, changed
 *            here, and previewed on a phone in light and dark BEFORE they
 *            are saved — a hex code tells nobody anything.
 *
 * Text on the club's colour is black or white, whichever reads; where a
 * colour cannot be read on a white or a dark screen the app uses a deeper or
 * lighter shade of it for buttons and links, and this screen says so in
 * words (lib/brand/colour.ts). Orange, green and red are not the club's to
 * change: they mean needs-you, going and out in every club.
 *
 * The database decides who may do this (academies_update and the logo
 * bucket's policies: owner and admin), not this screen.
 */
const PRESETS = [
  { name: 'Navy', value: '#202842' },
  { name: 'Royal blue', value: '#17418c' },
  { name: 'Bottle green', value: '#1c4634' },
  { name: 'Claret', value: '#6b1f32' },
  { name: 'Red', value: '#c8102e' },
  { name: 'Black', value: '#16181d' },
  { name: 'Gold', value: '#efbd5b' },
  { name: 'Sky', value: '#6cace4' },
]
const TYPES = ['image/png', 'image/jpeg', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024

export function ClubBranding({
  academyId,
  name,
  kind,
  primaryColour,
  secondaryColour,
  logoUrl,
}: {
  academyId: string
  name: string
  kind: string
  primaryColour: string | null
  secondaryColour: string | null
  logoUrl: string | null
}) {
  const word = kind === 'league' ? 'league' : 'club'
  const [saved, setSaved] = useState({ primary: normaliseHex(primaryColour) ?? '#202842', secondary: normaliseHex(secondaryColour) })
  const [primary, setPrimary] = useState(saved.primary)
  const [secondary, setSecondary] = useState<string | null>(saved.secondary)
  const [logo, setLogo] = useState(logoUrl)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [busy, setBusy] = useState<'logo' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const notes = useMemo(() => clubThemeNotes(primary, secondary), [primary, secondary])
  const dirty = primary !== saved.primary || secondary !== saved.secondary
  const told = () => window.dispatchEvent(new Event('squadroom:club-changed'))

  async function upload(f: File | null) {
    if (!f) return
    setError(null)
    setDone(null)
    if (!TYPES.includes(f.type)) return setError('A logo has to be a PNG, JPG or SVG file.')
    if (f.size > MAX_BYTES) return setError('That file is over 2 MB. A logo this size will do at 512 pixels across.')
    setBusy('logo')
    // The colours are read from the file in this browser while it uploads.
    const reading = suggestFromImage(f)
    const supabase = createClient()
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/svg+xml' ? 'svg' : 'jpg'
    const path = `${academyId}/logo-${Date.now()}.${ext}`
    const { error: up } = await supabase.storage.from('club-logos').upload(path, f, { contentType: f.type, upsert: true })
    if (up) {
      setBusy(null)
      return setError(up.message)
    }
    const url = supabase.storage.from('club-logos').getPublicUrl(path).data.publicUrl
    const { error: rpc } = await supabase.rpc('set_academy_logo', { p_academy: academyId, p_url: url })
    const found = await reading
    setBusy(null)
    if (rpc) return setError(rpc.message)
    setLogo(url)
    setSuggestion(found)
    told()
  }

  async function save() {
    setBusy('save')
    setError(null)
    setDone(null)
    const supabase = createClient()
    let { error } = await supabase.from('academies').update({ primary_colour: primary, secondary_colour: secondary }).eq('id', academyId)
    let note = 'Saved. Everyone in the ' + word + ' sees them next time they open the app.'
    // Before 0209 there is no column for the second colour. Keep the first.
    if (error && /secondary_colour/.test(error.message)) {
      ;({ error } = await supabase.from('academies').update({ primary_colour: primary }).eq('id', academyId))
      note = 'Saved your main colour. The second colour can’t be stored until Squadroom’s next database update.'
    }
    setBusy(null)
    if (error) return setError(error.message)
    setSaved({ primary, secondary })
    setDone(note)
    told()
  }

  const Swatch = ({ value, label, on, onPick }: { value: string; label: string; on: boolean; onPick: () => void }) => (
    <button
      onClick={onPick}
      aria-label={label}
      aria-pressed={on}
      className="h-9 w-9 rounded-[9px] border-2"
      style={{ background: value, borderColor: on ? 'var(--ink)' : 'transparent', boxShadow: 'inset 0 0 0 1px #00000024' }}
    />
  )

  return (
    <section data-club-branding>
      <h2 className="font-semibold">{word === 'league' ? 'League' : 'Club'} logo and colours</h2>
      <p className="mt-1 text-sm text-ink-2">
        Your logo replaces the initials everywhere, and your colours go on the bar at the top, the buttons and the tabs —
        for everyone in the {word} who chooses club colours (the default).
      </p>

      <div className="mt-3 flex items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- the club's own file, any format
          <img src={logo} alt={`${name} logo`} className="h-14 w-14 flex-none rounded-xl border bg-white object-contain p-1" style={{ borderColor: 'var(--line)' }} data-branding-logo />
        ) : (
          <span className="display grid h-14 w-14 flex-none place-items-center rounded-xl text-lg" style={{ background: primary, color: inkOn(primary) }}>
            {name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <button
            onClick={() => file.current?.click()}
            disabled={busy !== null}
            className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            data-upload-logo
          >
            {busy === 'logo' ? 'Uploading…' : logo ? 'Change logo' : 'Upload logo'}
          </button>
          <p className="mt-1 text-xs text-ink-3">PNG, JPG or SVG, up to 2 MB.</p>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden"
          aria-label="Logo file"
          onChange={(e) => { void upload(e.target.files?.[0] ?? null); e.target.value = '' }}
          data-logo-input
        />
      </div>

      {suggestion && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }} data-suggestion>
          <span className="text-sm">From your logo:</span>
          <span className="h-6 w-6 rounded-md" style={{ background: suggestion.primary, boxShadow: 'inset 0 0 0 1px #00000024' }} title={suggestion.primary} data-suggested-primary={suggestion.primary} />
          {suggestion.secondary && (
            <span className="h-6 w-6 rounded-md" style={{ background: suggestion.secondary, boxShadow: 'inset 0 0 0 1px #00000024' }} title={suggestion.secondary} data-suggested-secondary={suggestion.secondary} />
          )}
          <button
            onClick={() => { setPrimary(suggestion.primary); setSecondary(suggestion.secondary); setSuggestion(null) }}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            data-use-suggestion
          >
            Use these
          </button>
          <button onClick={() => setSuggestion(null)} className="tap text-sm text-ink-2 underline underline-offset-4">
            Keep mine
          </button>
        </div>
      )}

      <p className="eyebrow mt-4">Main colour</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Swatch key={p.value} value={p.value} label={p.name} on={primary === p.value} onPick={() => setPrimary(p.value)} />
        ))}
        <label className="flex items-center gap-2 rounded-[9px] border border-[var(--line)] px-2.5">
          <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value.toLowerCase())} className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Any main colour" data-primary-input />
          <span className="text-xs text-ink-2">{primary}</span>
        </label>
      </div>

      <p className="eyebrow mt-4">Second colour</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <button
          onClick={() => setSecondary(null)}
          aria-pressed={secondary === null}
          className="h-9 rounded-[9px] border-2 px-2.5 text-xs font-semibold"
          style={{ borderColor: secondary === null ? 'var(--ink)' : 'var(--line)' }}
        >
          None
        </button>
        {PRESETS.map((p) => (
          <Swatch key={p.value} value={p.value} label={`Second colour ${p.name}`} on={secondary === p.value} onPick={() => setSecondary(p.value)} />
        ))}
        <label className="flex items-center gap-2 rounded-[9px] border border-[var(--line)] px-2.5">
          <input type="color" value={secondary ?? '#ffffff'} onChange={(e) => setSecondary(e.target.value.toLowerCase())} className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0" aria-label="Any second colour" data-secondary-input />
          <span className="text-xs text-ink-2">{secondary ?? 'none'}</span>
        </label>
      </div>

      <p className="eyebrow mt-4">How it will look</p>
      <div className="mt-1.5 grid grid-cols-2 gap-3" data-branding-preview>
        <ClubPreview name={name} logo={logo} primary={primary} secondary={secondary} mode="light" />
        <ClubPreview name={name} logo={logo} primary={primary} secondary={secondary} mode="dark" />
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Text on your colour is {inkOn(primary) === '#ffffff' ? 'white' : 'black'}, whichever reads better. Orange, green and
        red stay as they are in every {word}: they mean needs you, going and out.
      </p>
      {notes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 rounded-xl p-3 text-sm" style={{ background: 'var(--surface-2)' }} data-contrast-notes>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--no-bg)', color: 'var(--no)' }}>{error}</p>}
      {done && !dirty && <p className="mt-3 text-sm" style={{ color: 'var(--yes)' }} data-branding-saved>{done}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={!dirty || busy !== null}
          className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          data-save-colours
        >
          {busy === 'save' ? 'Saving…' : 'Save colours'}
        </button>
        {dirty && (
          <button onClick={() => { setPrimary(saved.primary); setSecondary(saved.secondary) }} className="rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--line)' }}>
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
