import { Home } from './home'

/**
 * The front door, and a static shell.
 *
 * Nothing here touches the session, so there is no server round trip at all.
 * The browser asks who it is and what it can see, in one call to a database
 * that is a few milliseconds away from it — rather than a function in Ohio
 * asking on its behalf across the Pacific.
 */
export default function Page() {
  return <Home />
}
