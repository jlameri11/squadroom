import { ChatScreen } from './chat-screen'

/**
 * A static shell. No server session, no round trip — see proxy.ts.
 *
 * Authorisation has not moved: every row still comes through RLS under the
 * person's own identity. What moved is WHERE the question gets asked, and
 * asking it from a browser in Sydney costs a few milliseconds rather than a
 * Pacific crossing from Ohio and back.
 */
export default function ChatPage() {
  return <ChatScreen />
}
