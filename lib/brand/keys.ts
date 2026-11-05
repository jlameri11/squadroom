/** Where the browser keeps a person's appearance and their club's colours.
 *  Shared by the pre-paint script and the app; no imports, so the root
 *  layout can read it without pulling a client into the server bundle. */
export const APPEARANCE_KEY = 'squadroom.appearance'
/** Before Appearance there was only light or dark, under this key. */
export const LEGACY_THEME_KEY = 'squadroom.theme'
export const CLUB_KEY = 'squadroom.club'
