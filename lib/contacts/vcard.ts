/**
 * Building a vCard.
 *
 * Extracted from app/api/contacts/[profileId]/route.ts when the directory
 * gained a "save everybody" button. Two routes producing cards meant two
 * places for the field list to drift, and the field list is a privacy
 * decision: no email, because a synthetic @squadroom.invalid address in
 * somebody's address book is a dead number they will try to use, and nothing
 * about anybody's children.
 */
/**
 * vCard 3.0, which is the version every phone agrees about.
 *
 * 4.0 is newer and Android's importer is still patchy with it. The fields are
 * deliberately few: a name, a number, and who they are at this club. Nothing
 * about their children, and no email — a synthetic `@squadroom.invalid`
 * address in somebody's address book is a dead number they will try to use.
 */
export function vcard({
  name,
  phone,
  role,
  teams,
  academy,
}: {
  name: string
  phone: string | null
  role: string | null
  teams: string[]
  academy: string
}) {
  const parts = name.trim().split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : name

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(name)}`,
    `ORG:${esc(academy)}`,
  ]

  // "Coach · U8 SPL" in the title, because a phone's contact list shows it
  // under the name and that is the whole reason to save them.
  const title = [role ? role[0].toUpperCase() + role.slice(1) : null, teams.join(', ')]
    .filter(Boolean)
    .join(' · ')
  if (title) lines.push(`TITLE:${esc(title)}`)

  if (phone) lines.push(`TEL;TYPE=CELL:${esc(phone)}`)

  lines.push(`NOTE:${esc(`Saved from Squadroom · ${academy}`)}`)
  lines.push('END:VCARD')

  // CRLF, which the spec requires and some importers insist on.
  return lines.join('\r\n') + '\r\n'
}

/** Commas, semicolons, backslashes and newlines are structural in a vCard. */
function esc(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function safeFilename(name: string | null) {
  return (name ?? 'contact').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'contact'
}
