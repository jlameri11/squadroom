/**
 * What a home screen can be made of.
 *
 * The list is here and the VALID list is in 0106's check constraint, and they
 * have to agree — a layout is stored data, and a typo saved once is a broken
 * home screen until somebody edits it again. The database is the authority
 * on which ids exist; this adds the words a person reads when choosing.
 */
export type SectionId =
  | 'needs'
  | 'upcoming'
  | 'calendar'
  | 'chats'
  | 'competitions'
  | 'owing'

export const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: 'needs', label: 'Needs you', hint: 'Fees, approvals and games to answer' },
  { id: 'upcoming', label: 'Coming up', hint: 'The next few fixtures and sessions' },
  { id: 'calendar', label: 'Calendar', hint: 'The month at a glance' },
  { id: 'chats', label: 'Chats', hint: 'Your conversations and unread counts' },
  { id: 'competitions', label: 'Competitions', hint: 'Leagues and tournaments you are in' },
  { id: 'owing', label: 'Owed to the club', hint: 'What is outstanding — club admins only' },
]

export const labelOf = (id: string) =>
  SECTIONS.find((s) => s.id === id)?.label ?? id
