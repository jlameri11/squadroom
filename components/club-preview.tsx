import { GROUNDS, clubTheme, type Mode } from '@/lib/brand/colour'

/**
 * A phone screen in miniature, in a club's colours — what the owner is about
 * to choose, before they save it.
 *
 * Painted from the same arithmetic the app uses (lib/brand/colour.ts), with
 * the ground of the theme it stands for written out, so the light and the
 * dark preview can sit side by side whatever theme the owner is in. It shows
 * what the club's colours drive — the bar, a button, the active tab — and,
 * beside them, the three colours a club can never change: orange (needs
 * you), green (going), red (out).
 */
const INK: Record<Mode, { ink: string; ink2: string; ink3: string; line: string }> = {
  light: { ink: '#101012', ink2: '#4D4D55', ink3: '#62626B', line: '#DCDCE0' },
  dark: { ink: '#F4F4F5', ink2: '#B4B4BC', ink3: '#94949D', line: '#313136' },
}
const MEANING: Record<Mode, { accent: string; accentInk: string; yes: string; no: string }> = {
  light: { accent: '#C2410C', accentInk: '#ffffff', yes: '#1C7A4C', no: '#8E3020' },
  dark: { accent: '#FF7A45', accentInk: '#101012', yes: '#4FB587', no: '#E0826D' },
}

export function ClubPreview({
  name,
  logo,
  primary,
  secondary,
  mode,
}: {
  name: string
  logo: string | null
  primary: string
  secondary: string | null
  mode: Mode
}) {
  const t = clubTheme(primary, secondary, mode)
  if (!t) return null
  const g = GROUNDS[mode]
  const i = INK[mode]
  const m = MEANING[mode]
  return (
    <figure className="m-0 flex flex-col gap-1.5" data-club-preview={mode}>
      <div className="overflow-hidden rounded-[1.1rem] border-4" style={{ borderColor: '#101012', background: g.paper, color: i.ink }}>
        <div className="flex items-center gap-2 px-2.5 pb-2 pt-2.5" style={{ background: t['--bar'], color: t['--bar-ink'], borderBottom: `1px solid ${t['--bar-line']}` }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the club's own file
            <img src={logo} alt="" className="h-6 w-6 flex-none rounded-md bg-white object-contain p-px" />
          ) : (
            <span className="display grid h-6 w-6 flex-none place-items-center rounded-md text-[0.625rem]" style={{ background: `color-mix(in srgb, ${t['--bar-ink']} 16%, transparent)` }}>
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="display min-w-0 truncate text-[0.8125rem] leading-tight">{name}</span>
        </div>
        <div className="flex flex-col gap-1.5 p-2">
          <div className="rounded-lg p-2" style={{ background: g.surface, border: `1px solid ${i.line}` }}>
            <p className="text-[0.625rem] font-semibold" style={{ color: i.ink }}>Saturday · U9 v Hornsby</p>
            <p className="text-[0.5625rem]" style={{ color: t['--brand-text'] }}>ELS Hall Park, Field 3</p>
            <div className="mt-1.5 flex items-center gap-1">
              <span className="rounded-md px-1.5 py-0.5 text-[0.5625rem] font-semibold" style={{ background: t['--brand'], color: t['--brand-ink'] }}>Reply</span>
              <span className="rounded-md border px-1.5 py-0.5 text-[0.5625rem] font-semibold" style={{ borderColor: m.yes, color: m.yes }}>Going</span>
              <span className="rounded-md border px-1.5 py-0.5 text-[0.5625rem] font-semibold" style={{ borderColor: m.no, color: m.no }}>Out</span>
              <span className="ml-auto grid h-3.5 min-w-3.5 place-items-center rounded-full px-1 text-[0.5rem] font-bold" style={{ background: m.accent, color: m.accentInk }}>2</span>
            </div>
          </div>
        </div>
        <div className="flex justify-around border-t px-1 pb-1.5 pt-1" style={{ background: g.surface, borderColor: i.line }}>
          {['Home', 'Chat', 'Fixtures'].map((tab, n) => (
            <span key={tab} className="flex flex-col items-center gap-0.5 text-[0.5rem] font-semibold" style={{ color: n === 0 ? t['--brand-text'] : i.ink3 }}>
              {tab}
              <span className="h-[2px] w-3 rounded-full" style={{ background: n === 0 ? t['--highlight'] : 'transparent' }} />
            </span>
          ))}
        </div>
      </div>
      <figcaption className="text-center text-xs text-ink-3">{mode === 'light' ? 'Light' : 'Dark'}</figcaption>
    </figure>
  )
}
