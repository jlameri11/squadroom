'use client'

export type Child = {
  id: string
  name: string
  short_name: string
  team_id: string | null
  team_name: string | null
}

/**
 * A child's colour, derived from their id.
 *
 * Stable without a column: the same child is the same colour on every device,
 * every session and every academy, and nobody had to choose it. Storing one
 * would mean a migration, a default for every existing row and a settings
 * screen for a preference no parent has ever asked to set.
 *
 * The hash is djb2, which is not cryptography and does not need to be — all
 * it has to do is scatter two siblings' ids into different buckets.
 */
export function childColour(id: string) {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return `var(--kid-${(Math.abs(h) % 6) + 1})`
}

/**
 * Whose Saturday is this?
 *
 * E-04. Home shows a row per child on every fixture, which is right, and for
 * a parent with three children in two age groups it is also a wall of
 * buttons. One tap narrows it to one child.
 *
 * Renders NOTHING for a family with one child, which is most of them. A
 * filter with one option is a control that can only ever be turned off, and
 * the whole point of the feature is to spend screen space only where it is
 * doing work.
 *
 * "Everyone" is first and is the default, because the combined view is the
 * one a parent getting the family out the door actually wants; filtering is
 * for checking one thing.
 */
export function ChildChips({
  children,
  selected,
  onSelect,
}: {
  children: Child[]
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  if (children.length < 2) return null

  return (
    <div
      className="-mx-3.5 mb-2.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5"
      // The row scrolls rather than wraps: a family of four at 375px is wider
      // than the screen, and a second line of chips pushes the fixtures down
      // on every load for the sake of a control most people never touch.
      style={{ scrollbarWidth: 'none' }}
      role="group"
      aria-label="Show one child"
    >
      <Chip label="Everyone" on={selected === null} onClick={() => onSelect(null)} />
      {children.map((c) => (
        <Chip
          key={c.id}
          label={c.short_name}
          tint={childColour(c.id)}
          on={selected === c.id}
          onClick={() => onSelect(selected === c.id ? null : c.id)}
        />
      ))}
    </div>
  )
}

function Chip({
  label,
  tint,
  on,
  onClick,
}: {
  label: string
  tint?: string
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold"
      // Selected is the tint on a faint wash of itself, which is the same
      // language the RSVP buttons already speak. The obvious alternative —
      // white on a solid tint — breaks in dark mode, where the child colours
      // are the light ones and white text on them is unreadable. A selected
      // state that only works in one theme is not a selected state.
      style={
        on
          ? {
              borderColor: tint ?? 'var(--brand)',
              background: tint ? `color-mix(in srgb, ${tint} 16%, transparent)` : 'var(--brand-faint)',
              color: tint ?? 'var(--brand-text)',
            }
          : { borderColor: 'var(--line)', color: 'var(--ink-2)' }
      }
    >
      {/* The dot keeps the colour visible when the chip is off, which is how
          a parent learns which colour is which child without being told. */}
      {tint && (
        <span
          aria-hidden
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: tint }}
        />
      )}
      {label}
    </button>
  )
}
