'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_APPEARANCE, readAppearance, readClub, saveAppearance, type Appearance, type ColourMode, type Design } from '@/lib/brand/appearance'

/**
 * Settings → Appearance (Joey, 4 Nov 2026).
 *
 * Two choices, which make the four designs: the club's colours or
 * Squadroom's black and white, each light or dark — and "Match my phone" for
 * light or dark, the default. It changes how the app looks for this person
 * and nobody else: the choice is kept on this phone and in their own profile
 * row, which only they can write.
 *
 * Takes effect the moment it is tapped (the theme controller listens), so
 * the screen itself is the preview.
 */
export function AppearanceSettings() {
  const [a, setA] = useState<Appearance | null>(null)
  const [club, setClub] = useState<{ name: string; primary: string } | null>(null)

  useEffect(() => {
    let live = true
    // localStorage is the browser's: read after mount, never during render.
    ;(async () => {
      const now = readAppearance()
      const c = readClub()
      if (!live) return
      setA(now)
      setClub(c ? { name: c.name, primary: c.primary } : null)
    })()
    return () => {
      live = false
    }
  }, [])

  if (!a) return null

  const choose = (next: Partial<Appearance>) => {
    const merged = { ...a, ...next }
    setA(merged)
    void saveAppearance(merged)
  }

  const DESIGNS: { value: Design; label: string; hint: string; bar: string }[] = [
    {
      value: 'club',
      label: 'Club colours',
      hint: club ? `${club.name}'s colours on the bar, the buttons and the tabs.` : 'Your club’s colours on the bar, the buttons and the tabs.',
      bar: club?.primary ?? 'var(--ink-3)',
    },
    { value: 'mono', label: 'Black & white', hint: 'Squadroom’s own look: white on black, colour only where it means something.', bar: '#101012' },
  ]
  const MODES: { value: ColourMode; label: string }[] = [
    { value: 'system', label: 'Match my phone' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  return (
    <section className="mt-6" id="appearance" data-appearance-design={a.design} data-appearance-mode={a.mode}>
      <h2 className="font-semibold">Appearance</h2>
      <p className="mt-0.5 text-sm text-ink-2">How the app looks for you. Nobody else’s changes.</p>

      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9.5rem),1fr))] gap-2" role="radiogroup" aria-label="Colours">
        {DESIGNS.map((d) => {
          const on = a.design === d.value
          return (
            <button
              key={d.value}
              role="radio"
              aria-checked={on}
              onClick={() => choose({ design: d.value })}
              className="flex flex-col gap-2 rounded-xl border p-2.5 text-left"
              style={{ borderColor: on ? 'var(--brand)' : 'var(--line)', borderWidth: on ? 2 : 1, background: 'var(--surface)' }}
              data-design={d.value}
            >
              {/* A phone in miniature: the bar in these colours over a page. */}
              <span className="block overflow-hidden rounded-lg border" style={{ borderColor: 'var(--line)' }} aria-hidden>
                <span className="block h-4" style={{ background: d.bar }} />
                <span className="flex gap-1 p-1.5" style={{ background: 'var(--paper)' }}>
                  <span className="h-2 flex-1 rounded-sm" style={{ background: 'var(--surface)' }} />
                  <span className="h-2 w-5 rounded-sm" style={{ background: d.value === 'club' && club ? club.primary : 'var(--ink)' }} />
                </span>
              </span>
              <span>
                <span className="block text-sm font-semibold">{d.label}{d.value === DEFAULT_APPEARANCE.design ? ' (default)' : ''}</span>
                <span className="mt-0.5 block text-xs text-ink-3">{d.hint}</span>
              </span>
            </button>
          )
        })}
      </div>

      <p className="eyebrow mt-4">Light or dark</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Light or dark">
        {MODES.map((m) => {
          const on = a.mode === m.value
          return (
            <button
              key={m.value}
              role="radio"
              aria-checked={on}
              onClick={() => choose({ mode: m.value })}
              className="min-w-fit flex-1 rounded-xl border px-3 py-2 text-sm font-semibold"
              style={on ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' } : { borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              data-mode={m.value}
            >
              {m.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
