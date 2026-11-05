/**
 * How the app looks for ONE person (Joey, 4 Nov 2026: Settings → Appearance).
 *
 * Two choices, which together make the four designs:
 *
 *   colours        "club" — the club's colours on the bar, the buttons and
 *                  the active tab (the default); or "mono" — Squadroom's own
 *                  black and white;
 *   light or dark  "system" — match the phone (the default); "light"; "dark".
 *
 * Kept in the browser (so the first frame is already right, with no flash)
 * and in the person's own profile row (so the choice follows them to another
 * phone). Nobody else ever sees it: it is read only for the person signed
 * in, and RLS lets a person update only their own profile.
 *
 * Until migration 0209 adds `profiles.appearance` and `colour_mode`, the
 * profile half quietly does nothing and the choice lives on this phone.
 */
import { createClient } from '@/lib/supabase/client'
import { usesClubTheme } from '@/lib/routes'
import { APPEARANCE_KEY, CLUB_KEY, LEGACY_THEME_KEY } from '@/lib/brand/keys'

export { APPEARANCE_KEY, CLUB_KEY, LEGACY_THEME_KEY }

export type Design = 'club' | 'mono'
export type ColourMode = 'system' | 'light' | 'dark'
export type Appearance = { design: Design; mode: ColourMode }

export const DEFAULT_APPEARANCE: Appearance = { design: 'club', mode: 'system' }
/** Fired on window when the appearance or the club's colours change. */
export const THEME_EVENT = 'squadroom:theme'
const STYLE_ID = 'club-theme'

/** The club whose colours this browser paints, with its stylesheet ready. */
export type ClubCache = {
  id: string
  name: string
  logo: string | null
  primary: string
  secondary: string | null
  css: string
}

const isDesign = (v: unknown): v is Design => v === 'club' || v === 'mono'
const isMode = (v: unknown): v is ColourMode => v === 'system' || v === 'light' || v === 'dark'

export function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? 'null') as Partial<Appearance> | null
    const legacy = localStorage.getItem(LEGACY_THEME_KEY)
    return {
      design: isDesign(raw?.design) ? raw.design : DEFAULT_APPEARANCE.design,
      mode: isMode(raw?.mode) ? raw.mode : isMode(legacy) ? legacy : DEFAULT_APPEARANCE.mode,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function readClub(): ClubCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CLUB_KEY) ?? 'null') as ClubCache | null
    return c && typeof c.id === 'string' && typeof c.css === 'string' ? c : null
  } catch {
    return null
  }
}

export function writeClub(c: ClubCache | null) {
  try {
    if (c) localStorage.setItem(CLUB_KEY, JSON.stringify(c))
    else localStorage.removeItem(CLUB_KEY)
  } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT))
}

/**
 * Puts the page in the right clothes: light or dark on <html data-theme>,
 * and the club's stylesheet switched on by <html data-club> — only on the
 * app's own screens, and only when this person wears club colours.
 */
export function applyTheme(pathname: string) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const a = readAppearance()
  if (a.mode === 'light' || a.mode === 'dark') root.dataset.theme = a.mode
  else delete root.dataset.theme

  const club = a.design === 'club' && usesClubTheme(pathname) ? readClub() : null
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (club) {
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    if (style.textContent !== club.css) style.textContent = club.css
    root.dataset.club = club.id
  } else {
    delete root.dataset.club
  }
  root.dataset.design = a.design
}

/**
 * Saves the choice on this phone at once, then to the person's profile so it
 * follows them. The profile write is best effort: offline, or before 0209,
 * the phone's copy is the one that counts.
 */
export async function saveAppearance(a: Appearance): Promise<{ synced: boolean }> {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a))
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT))
  try {
    const supabase = createClient()
    const { data } = await supabase.auth.getClaims()
    const uid = data?.claims?.sub
    if (!uid) return { synced: false }
    const { error } = await supabase
      .from('profiles')
      .update({ appearance: a.design, colour_mode: a.mode })
      .eq('id', uid)
    return { synced: !error }
  } catch {
    return { synced: false }
  }
}

/**
 * The profile's copy wins over the phone's when the two differ — it is the
 * one the person last set on any device. Returns true when it changed
 * anything. A profile without the columns (before 0209) changes nothing.
 */
export function adoptProfileAppearance(profile: Record<string, unknown> | null | undefined): boolean {
  if (!profile || !isDesign(profile.appearance) || !isMode(profile.colour_mode)) return false
  const now = readAppearance()
  if (now.design === profile.appearance && now.mode === profile.colour_mode) return false
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ design: profile.appearance, mode: profile.colour_mode }))
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {}
  return true
}
