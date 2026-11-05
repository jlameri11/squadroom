'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { getOrg, useOrg } from '@/lib/org'
import { clubThemeCss, normaliseHex } from '@/lib/brand/colour'
import { THEME_EVENT, adoptProfileAppearance, applyTheme, readClub, writeClub } from '@/lib/brand/appearance'

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
      const { data: claims } = await supabase.auth.getClaims()
      const uid = claims?.claims?.sub
      if (!live) return
      if (!uid) {
        // Signed out: nobody's club colours stay behind on a shared phone.
        if (readClub()) writeClub(null)
        return
      }
      // `*`, not a column list: secondary_colour and the appearance columns
      // arrive with 0209, and naming a column that is not there yet would
      // fail the whole read.
      const [{ data: profile }, { data: rows }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
        supabase.from('academy_members').select('academies(*)').eq('profile_id', uid).eq('status', 'active'),
      ])
      if (!live) return
      if (adoptProfileAppearance(profile as Record<string, unknown> | null)) applyTheme(window.location.pathname)

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
