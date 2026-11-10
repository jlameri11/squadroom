'use client'

/** The one control on the sheet, hidden from the printout itself. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print mt-8 w-full rounded-xl px-4 py-3 font-semibold"
      style={{ background: '#101012', color: '#ffffff' }}
      data-print
    >
      Print
    </button>
  )
}
