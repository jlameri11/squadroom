'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getOrg, useOrg } from '@/lib/org'
import { clubThemeCss, normaliseHex } from '@/lib/brand/colour'
import { THEME_EVENT, adoptProfileAppearance, applyTheme, pendingAppearance, readClub, saveAppearance, writeClub } from '@/lib/brand/appearance'

type ClubRow = {
  id: string
  name: string
  logo_url: string | null
  primary_colour: string | null
  secondary_colour?: string | null
}

/**
 * Keeps the page in the right clothes after the first frame.
 *
 * The pre-paint script (lib/brand/theme-script.ts) dresses the first frame
 * from what this browser remembered. This then:
 *   - re-applies on every navigation, because moving from Home (the club's
 *     colours) to /for-clubs (Squadroom's) is a client-side route change and
 *     <html> stays where it is;
 *   - asks the database for the club's colours as they are now — the
 *     organisation the browser is showing, else the person's first — and
 *     remembers them for the next first frame;
 *   - adopts the person's appearance from their profile, so a choice made on
 *     another phone arrives here.
 * Renders nothing.
 */
export function ThemeController() {
  const pathname = usePathname()
  const org = useOrg()

  useEffect(() => {
    applyTheme(pathname)
  }, [pathname])

  useEffect(() => {
    const again = () => applyTheme(window.location.pathname)
    window.addEventListener(THEME_EVENT, again)
    window.addEventListener('storage', again)
    return () => {
      window.removeEventListener(THEME_EVENT, again)
      window.removeEventListener('storage', again)
    }
  }, [])

  useEffect(() => {
    let live = true
    const refresh = async () => {
      const supabase = createClient()
      // The phone's own session is enough to choose colours: getClaims()
      // verified the token against the auth server's keys first, a request
      // on every page load for a theme (time-screens, 6 Nov 2026).
      const { data: s } = await supabase.auth.getSession()
      const uid = s.session?.user.id
      if (!live) return
      if (!uid) {
        // Signed out: nobody's club colours stay behind on a shared phone.
        if (readClub()) writeClub(null)
        return
      }
      // The two appearance columns by name. `*` was refused outright — the
      // phone column is withheld from everyone (0012), so asking for every
      // column is asking for one you may not have — and so a person's own
      // Appearance never loaded (found by time-screens, 6 Nov 2026). Before
      // 0209 the columns are not there and this answers an error, which
      // reads as "nothing chosen".
      const [{ data: profile }, { data: rows }] = await Promise.all([
        supabase.from('profiles').select('appearance, colour_mode').eq('id', uid).maybeSingle(),
        supabase.from('academy_members').select('academies(*)').eq('profile_id', uid).eq('status', 'active'),
      ])
      if (!live) return
      // A choice made on this phone that never reached the profile (the tab
      // closed first) is sent now rather than overwritten by the older one.
      const pending = pendingAppearance()
      if (pending) void saveAppearance(pending)
      else if (adoptProfileAppearance(profile as Record<string, unknown> | null)) applyTheme(window.location.pathname)

      const clubs = ((rows ?? []) as unknown as { academies: ClubRow | null }[])
        .map((r) => r.academies)
        .filter((a): a is ClubRow => Boolean(a))
        .sort((a, b) => a.name.localeCompare(b.name))
      const club = clubs.find((c) => c.id === getOrg()) ?? clubs[0]
      const primary = normaliseHex(club?.primary_colour)
      if (!club || !primary) {
        if (readClub()) writeClub(null)
        return
      }
      const secondary = normaliseHex(club.secondary_colour ?? null)
      const css = clubThemeCss(primary, secondary)
      const cached = readClub()
      if (cached?.id !== club.id || cached.css !== css || cached.logo !== (club.logo_url ?? null) || cached.name !== club.name) {
        writeClub({ id: club.id, name: club.name, logo: club.logo_url ?? null, primary, secondary, css })
      }
    }
    void refresh()
    // A club's owner saving new colours fires this; so does signing in.
    const onClub = () => void refresh()
    window.addEventListener('squadroom:club-changed', onClub)
    return () => {
      live = false
      window.removeEventListener('squadroom:club-changed', onClub)
    }
  }, [org])

  return null
}
