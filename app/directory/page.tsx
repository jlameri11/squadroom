import { DirectoryScreen } from './directory-screen'

/**
 * A static shell. See proxy.ts and lib/hooks/use-screen.ts.
 *
 * This page used to make four server round trips — the session, the academy,
 * the directory and the caller's role — serially, from Ohio to Sydney. 902ms
 * before it drew anything.
 */
export default function DirectoryPage() {
  return <DirectoryScreen />
}
