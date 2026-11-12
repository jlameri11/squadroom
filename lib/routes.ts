/**
 * Which pages are the app, which are public, and which wear the club's
 * colours. Shared by the tab bar (components/app-shell.tsx), the theme
 * (components/theme-controller.tsx) and the script that paints the club's
 * colours before the first frame (lib/brand/theme-script.ts), so the three
 * can never disagree about a page.
 */

/**
 * Screens that have no tab bar.
 *
 * A full-screen conversation and the join flow are not places you tab away
 * from — the conversation has its own back arrow, and the join flow is for
 * somebody who is not signed in yet and has nowhere to go.
 */
export const BARE = [
  '/signin', '/signup', '/start', '/auth',
  '/join', '/join-competition',
  // Opened by people with no account at all — a child with their family's
  // link, or anyone with a public competition link. Offering them Home and
  // Chat would be offering a sign-in screen to someone who must not have one.
  '/my', '/c',
  // The front door for a club that has heard of us, the privacy page, and
  // the status page ("is it just me?") — none of them wants a sign-in.
  '/for-clubs', '/privacy', '/status',
  // Find a club (0266): a family with no account searching for one.
  '/clubs',
]

/**
 * Every top-level route the app itself owns. Anything else at one segment —
 * /nrifa, /ravens — is a club's public front door (app/[slug]), opened by
 * people with no account.
 *
 * Listed rather than inferred because a dynamic segment at the root cannot
 * be told from an app route by its shape: `/nrifa` and `/chat` are both one
 * word. A new top-level route has to be added here, and test-screens will
 * say so the first time its tab bar goes missing.
 */
export const APP_ROOTS = new Set([
  'admin', 'api', 'auth', 'c', 'calendar', 'card', 'chat', 'clubs', 'competitions', 'directory',
  'for-clubs', 'join', 'join-competition', 'my', 'offer', 'payments', 'platform', 'privacy', 'programs', 'ref', 'referee',
  'scan', 'settings', 'signin', 'signup', 'start', 'status',
])

/** A page opened by somebody who must not be offered a sign-in screen. */
export function isPublicPage(pathname: string) {
  if (BARE.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return false
  if (APP_ROOTS.has(segments[0])) return false
  // A club's front door (/<slug>) and its register page (/<slug>/register).
  // The register page used to be matched on its own; found by screenshotting
  // it, when the tab bar offered a family with no account Home, Chat,
  // Fixtures and Team — every one a sign-in screen for somebody who must not
  // have one. The front door then had the same bar, found the same way.
  return segments.length === 1 || (segments.length === 2 && segments[1] === 'register')
}

/**
 * Squadroom's own pages inside the app's routes. They wear Squadroom's black
 * and white whatever the reader's club is — the platform console is not any
 * club's (CLAUDE.md, the brand).
 */
export const SQUADROOM_ROOTS = ['platform']

/**
 * Does this page wear the reader's club colours? The app's own screens do.
 * Sign-in, the join flow, /for-clubs, the status and privacy pages and the
 * platform console are Squadroom's and stay black and white; a club's public
 * pages paint themselves in THAT club's colours, never the reader's.
 */
export function usesClubTheme(pathname: string) {
  if (isPublicPage(pathname)) return false
  const first = pathname.split('/').filter(Boolean)[0]
  return !SQUADROOM_ROOTS.includes(first ?? '')
}
