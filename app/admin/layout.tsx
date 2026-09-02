/**
 * No navigation of its own.
 *
 * This used to carry a horizontally-scrolling bar of eight links — Chat,
 * Fixtures, Comps, Directory, Requests, Teams, Invites, Members — from before
 * the app had a tab bar or an admin hub. Every one of those is now either a
 * tab at the bottom or a row on /admin, so it was a third navigation offering
 * the same destinations in a different order, which is the kind of thing that
 * makes an app feel like a website.
 *
 * The sub-pages carry a back arrow to /admin instead.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
