import { ImportClient } from './import-client'

/**
 * A static shell; the browser fetches.
 *
 * This page used to resolve the academy server-side as `academies[0]` ordered
 * by name, which ignored the organisation switcher completely — a coach at two
 * clubs would import a draw into whichever came first alphabetically. The same
 * defect 0105 fixed for the home screen, unnoticed here because nothing linked
 * the two. The choice lives in the browser (see 0080), so the page has to ask.
 */
export default function ImportPage() {
  return <ImportClient />
}
