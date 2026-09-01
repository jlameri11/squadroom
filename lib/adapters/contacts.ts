/**
 * Contact picking, behind an adapter so the Capacitor plugin can replace the
 * web implementation without anything above this file changing.
 *
 * The deliberate shape of this API: it returns only what the person chose.
 * There is no "read the address book" call, because we never want one. A
 * coach's phone holds their doctor, their ex, their kids' friends' parents —
 * people who have no relationship with the academy and never agreed to be in
 * our database. Uploading that wholesale would put personal information about
 * non-users on our servers, which is both a Privacy Act problem and the kind
 * of thing that ends a product built around other people's children.
 *
 * So: the OS shows the picker, the person taps the ones they mean, and only
 * those come back. Nothing is sent anywhere until they confirm on the review
 * screen after this.
 */

import { isNative } from './native'

export type PickedContact = {
  name: string
  phone: string
}

export type ContactPicker = {
  /** False on iOS Safari and desktop, where no picker exists. Check before showing the button. */
  isSupported(): boolean
  /** Resolves to the chosen contacts, or an empty array if they cancelled. */
  pick(): Promise<PickedContact[]>
}

type NavigatorWithContacts = Navigator & {
  contacts?: {
    select(props: string[], opts?: { multiple?: boolean }): Promise<
      Array<{ name?: string[]; tel?: string[] }>
    >
  }
}

/**
 * Web implementation, via the Contact Picker API.
 *
 * Chrome on Android only. Safari does not implement it and Apple has given no
 * indication it will, so on iPhone this returns false and the UI must fall
 * back to pasting numbers — until the Capacitor build, where the native
 * plugin covers both platforms.
 */
export const webContactPicker: ContactPicker = {
  isSupported() {
    if (typeof navigator === 'undefined') return false
    const nav = navigator as NavigatorWithContacts
    return typeof nav.contacts?.select === 'function' && window.isSecureContext
  },

  async pick() {
    const nav = navigator as NavigatorWithContacts
    if (!nav.contacts) return []

    // The browser renders this picker itself; the page never sees the list.
    const chosen = await nav.contacts.select(['name', 'tel'], { multiple: true })

    return chosen
      .map((c) => ({
        name: c.name?.[0]?.trim() ?? '',
        phone: normalisePhone(c.tel?.[0] ?? ''),
      }))
      .filter((c) => c.name !== '' && c.phone !== '')
  },
}

/**
 * Australian numbers as people actually store them: 0412 345 678,
 * +61 412 345 678, (02) 9999 1234. Everything becomes E.164 or nothing.
 * Returning '' for anything we cannot confidently parse is deliberate — a
 * half-guessed number silently invites a stranger into a team channel.
 */
export function normalisePhone(raw: string, defaultCountry = '61'): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits === '') return ''
  if (digits.startsWith('+')) return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : ''
  if (digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`
  if (digits.startsWith(defaultCountry)) return `+${digits}`
  return ''
}

/**
 * Native implementation.
 *
 * This is the one that closes the iPhone gap: Safari has no Contact Picker
 * and never will, so until now a coach on an iPhone had to type or paste
 * every number by hand while a coach on Android tapped a list.
 *
 * The privacy shape above is NOT relaxed here just because the platform
 * would allow it. @capacitor-community/contacts can return the entire
 * address book in one call, and it must never be asked to. The OS permission
 * prompt says "Squadroom would like to access your contacts", and a coach
 * granting that is agreeing to pick some people, not to upload their doctor
 * and their ex.
 *
 * So the read is limited to what is needed to render our own picker, nothing
 * is transmitted, and the review screen after this is still where the coach
 * confirms who is actually invited.
 */
export const nativeContactPicker: ContactPicker = {
  isSupported() {
    return isNative()
  },

  async pick() {
    const { Contacts } = await import('@capacitor-community/contacts')

    const permission = await Contacts.requestPermissions()
    if (permission.contacts !== 'granted') return []

    // pickContact shows the SYSTEM picker and returns only the tapped
    // person. getContacts, which returns everything, is deliberately not
    // used — see the note above.
    const { contact } = await Contacts.pickContact({
      projection: { name: true, phones: true },
    })
    if (!contact) return []

    const name = contact.name?.display?.trim() ?? ""
    const phone = normalisePhone(contact.phones?.[0]?.number ?? "")
    return name !== "" && phone !== "" ? [{ name, phone }] : []
  },
}

/**
 * One picker for callers to use. Deciding here rather than at each call site
 * is the whole point of the adapter — a page that asks which platform it is
 * on is a page that will need rewriting for native.
 */
export const contacts: ContactPicker = {
  isSupported: () => (isNative() ? nativeContactPicker : webContactPicker).isSupported(),
  pick: () => (isNative() ? nativeContactPicker : webContactPicker).pick(),
}
